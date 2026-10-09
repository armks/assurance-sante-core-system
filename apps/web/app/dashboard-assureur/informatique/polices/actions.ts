'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';
import type { Simulation } from './types';

const CIBLE = '/dashboard-assureur/informatique/polices';

type ResultatSimple = { ok: true } | { ok: false; error: string };

/** Crée un devis (police au statut DEVIS) sur un produit PUBLIE. */
export async function creerDevis(input: {
  souscripteurId: string;
  produitId: string;
  dateDebut?: string;
  dateFin?: string;
}): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  );
  const res = await apiFetch('/api/v1/policy/polices', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const p = (await res.json()) as { numeroPolice: string };
  revalidatePath(CIBLE);
  return { ok: true, message: `Devis ${p.numeroPolice} créé.` };
}

/** Souscription guidée DEVIS/EN_SOUSCRIPTION → ACTIVE (avec dates). */
export async function souscrirePolice(
  id: string,
  input: { dateDebut?: string; dateFin?: string },
): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  );
  const res = await apiFetch(`/api/v1/policy/polices/${id}/souscrire`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(`${CIBLE}/${id}`);
  revalidatePath(CIBLE);
  return { ok: true, message: 'Police activée.' };
}

/** Transition de statut via la machine à états (POST :id/statut). */
export async function changerStatut(
  id: string,
  statut: string,
): Promise<ResultatSimple> {
  const res = await apiFetch(`/api/v1/policy/polices/${id}/statut`, {
    method: 'POST',
    body: JSON.stringify({ statut }),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(`${CIBLE}/${id}`);
  revalidatePath(CIBLE);
  return { ok: true };
}

/** Aperçu de proratisation avant confirmation — ne persiste rien. */
export async function simulerAvenant(
  id: string,
  input: { type: string; dateEffet: string; tarifMensuelFormule?: number },
): Promise<{ ok: true; simulation: Simulation } | { ok: false; error: string }> {
  const body = Object.fromEntries(
    Object.entries(input).filter(
      ([, v]) => v !== undefined && v !== '' && !Number.isNaN(v as number),
    ),
  );
  const res = await apiFetch(`/api/v1/policy/polices/${id}/avenants/simulation`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  return { ok: true, simulation: (await res.json()) as Simulation };
}

/** Crée l'avenant (statut BROUILLON) — la proratisation est recalculée côté API. */
export async function creerAvenant(
  id: string,
  input: { type: string; dateEffet: string; tarifMensuelFormule?: number },
): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(
      ([, v]) => v !== undefined && v !== '' && !Number.isNaN(v as number),
    ),
  );
  const res = await apiFetch(`/api/v1/policy/polices/${id}/avenants`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(`${CIBLE}/${id}`);
  return { ok: true, message: 'Avenant créé.' };
}

export async function appliquerAvenant(
  id: string,
  avenantId: string,
): Promise<ResultatSimple> {
  const res = await apiFetch(
    `/api/v1/policy/polices/${id}/avenants/${avenantId}/appliquer`,
    { method: 'POST' },
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(`${CIBLE}/${id}`);
  return { ok: true };
}

/** Annule un avenant APPLIQUE — motif OBLIGATOIRE, jamais de suppression (ADR-007). */
export async function annulerAvenant(
  id: string,
  avenantId: string,
  motif: string,
): Promise<ResultatSimple> {
  const res = await apiFetch(
    `/api/v1/policy/polices/${id}/avenants/${avenantId}/annuler`,
    { method: 'POST', body: JSON.stringify({ motif }) },
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(`${CIBLE}/${id}`);
  return { ok: true };
}

/** Modifie un avenant en BROUILLON (type, date d'effet, impact recalculé). */
export async function modifierAvenant(
  id: string,
  avenantId: string,
  input: { type: string; dateEffet: string; tarifMensuelFormule?: number },
): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== '' && !Number.isNaN(v as number)),
  );
  const res = await apiFetch(`/api/v1/policy/polices/${id}/avenants/${avenantId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(`${CIBLE}/${id}`);
  return { ok: true, message: 'Avenant modifié.' };
}

/** Supprime (logique) un avenant en BROUILLON. */
export async function supprimerAvenant(id: string, avenantId: string): Promise<ResultatSimple> {
  const res = await apiFetch(`/api/v1/policy/polices/${id}/avenants/${avenantId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) return { ok: false, error: await messageErreur(res) };
  revalidatePath(`${CIBLE}/${id}`);
  return { ok: true };
}

/** Modification libre d'une police au stade du DEVIS. */
export async function modifierPolice(
  id: string,
  input: { produitId?: string; dateDebut?: string; dateFin?: string },
): Promise<ResultatSoumission> {
  const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== ''));
  const res = await apiFetch(`/api/v1/policy/polices/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(`${CIBLE}/${id}`);
  revalidatePath(CIBLE);
  return { ok: true, message: 'Devis modifié.' };
}

/** Supprime (logique) un devis sans aucun lien. */
export async function supprimerPolice(id: string): Promise<ResultatSimple> {
  const res = await apiFetch(`/api/v1/policy/polices/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  return { ok: true };
}

/** « Dupliquer en devis » depuis une police terminée. */
export async function dupliquerEnDevis(
  id: string,
): Promise<{ ok: true; id: string; numeroPolice: string } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/policy/polices/${id}/dupliquer`, { method: 'POST' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const p = (await res.json()) as { id: string; numeroPolice: string };
  revalidatePath(CIBLE);
  return { ok: true, id: p.id, numeroPolice: p.numeroPolice };
}
