'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';
import type { Calcul } from './types';

const CIBLE = '/dashboard-assureur/informatique/cotisations';

/** `2026-05` (month input) → `2026-05-01` ; laisse tel quel si déjà une date. */
const jour1 = (periode: string) =>
  /^\d{4}-\d{2}$/.test(periode) ? `${periode}-01` : periode;

/** Aperçu du tarif applicable — ne persiste rien. */
export async function calculerCotisation(input: {
  policeId: string;
  periode: string;
  age: number;
}): Promise<{ ok: true; calcul: Calcul } | { ok: false; error: string }> {
  const res = await apiFetch('/api/v1/billing/cotisations/calculer', {
    method: 'POST',
    body: JSON.stringify({
      policeId: input.policeId,
      periode: jour1(input.periode),
      age: input.age,
    }),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  return { ok: true, calcul: (await res.json()) as Calcul };
}

/** Génère réellement la ligne de cotisation pour un adhérent d'une police ACTIVE. */
export async function genererCotisation(input: {
  policeId: string;
  periode: string;
  adherentId: string;
  age: number;
  dateEcheance?: string;
}): Promise<ResultatSoumission> {
  const res = await apiFetch(
    `/api/v1/billing/polices/${input.policeId}/cotisations`,
    {
      method: 'POST',
      body: JSON.stringify({
        periode: jour1(input.periode),
        ...(input.dateEcheance ? { dateEcheance: input.dateEcheance } : {}),
        adherents: [{ adherentId: input.adherentId, age: input.age }],
      }),
    },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const r = (await res.json()) as { generees: number };
  revalidatePath(CIBLE);
  return {
    ok: true,
    message:
      r.generees > 0
        ? 'Cotisation générée.'
        : 'Aucune cotisation générée (déjà existante pour cette période).',
  };
}

/** Enregistre un paiement (partiel ou complet) sur une cotisation A_PAYER / EN_RETARD. */
export async function enregistrerPaiement(
  cotisationId: string,
  montant: number,
): Promise<ResultatSoumission> {
  const res = await apiFetch(
    `/api/v1/billing/cotisations/${cotisationId}/paiement`,
    { method: 'POST', body: JSON.stringify({ montant }) },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const c = (await res.json()) as { statut: string; montantPaye: string };
  revalidatePath(CIBLE);
  return {
    ok: true,
    message: `Paiement enregistré — ${Number(c.montantPaye).toLocaleString('fr-FR')} F payés, statut ${c.statut}.`,
  };
}

/**
 * Déclenche manuellement le passage EN_RETARD des cotisations A_PAYER échues
 * (tâche jusqu'ici uniquement batch, sans interface).
 */
export async function marquerCotisationsEnRetard(): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/billing/cotisations/marquer-en-retard', {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const r = (await res.json()) as { misEnRetard: number };
  revalidatePath(CIBLE);
  return {
    ok: true,
    message:
      r.misEnRetard > 0
        ? `${r.misEnRetard} cotisation(s) passée(s) EN_RETARD.`
        : 'Aucune cotisation échue à marquer en retard.',
  };
}

/** Crée une grille tarifaire négociée (souscripteur renseigné) ou standard. */
export async function creerGrille(input: {
  produitId: string;
  souscripteurId?: string;
  trancheAgeMin: number;
  trancheAgeMax: number;
  montantMensuel: number;
}): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  );
  const res = await apiFetch('/api/v1/billing/grilles-tarifaires', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Grille tarifaire créée.' };
}

/** Modifie une grille, même déjà utilisée : chaque cotisation garde le montant calculé à sa date. */
export async function modifierGrille(
  id: string,
  input: { trancheAgeMin: number; trancheAgeMax: number; montantMensuel: number },
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/billing/grilles-tarifaires/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Grille modifiée. Les cotisations déjà calculées ne changent pas.' };
}

/** Supprime une grille jamais utilisée par un calcul. */
export async function supprimerGrille(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/billing/grilles-tarifaires/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  return { ok: true };
}
