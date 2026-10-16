'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

/** Pages qui affichent le bandeau d'annonces, plus les deux écrans de gestion (assureur et superadmin). */
function rafraichir() {
  revalidatePath('/dashboard-assureur/informatique/annonces');
  revalidatePath('/superadmin/annonces');
  revalidatePath('/');
  revalidatePath('/[slug]', 'page');
}

export interface AnnonceInput {
  texte: string;
  dureeAffichageSecondes?: number;
  dateDebut?: string;
  dateFin?: string | null;
  actif?: boolean;
  /** Superadmin : société visée ; `TOUTES` = toutes les pages d'accueil. */
  portee?: string;
}

const iso = (v?: string | null) => (v ? new Date(v).toISOString() : v === null ? null : undefined);

export async function creerAnnonce(input: AnnonceInput): Promise<ResultatSoumission> {
  const body = {
    texte: input.texte,
    dureeAffichageSecondes: input.dureeAffichageSecondes,
    dateDebut: iso(input.dateDebut) ?? undefined,
    dateFin: iso(input.dateFin) ?? undefined,
    actif: input.actif,
    ...(input.portee === 'TOUTES' ? { toutesLesPages: true } : input.portee ? { organisationId: input.portee } : {}),
  };
  const res = await apiFetch('/api/v1/vitrine/annonces', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  rafraichir();
  return { ok: true, message: 'Annonce enregistrée : elle défile sur la page d’accueil pendant sa période de diffusion.' };
}

export async function modifierAnnonce(id: string, input: AnnonceInput): Promise<ResultatSoumission> {
  const body = {
    texte: input.texte,
    dureeAffichageSecondes: input.dureeAffichageSecondes,
    dateDebut: iso(input.dateDebut) ?? undefined,
    dateFin: iso(input.dateFin),
    actif: input.actif,
  };
  const res = await apiFetch(`/api/v1/vitrine/annonces/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  rafraichir();
  return { ok: true, message: 'Annonce modifiée.' };
}

export async function basculerAnnonce(id: string, actif: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/vitrine/annonces/${id}`, { method: 'PATCH', body: JSON.stringify({ actif }) });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  rafraichir();
  return { ok: true };
}

export async function supprimerAnnonce(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/vitrine/annonces/${id}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  rafraichir();
  return { ok: true };
}
