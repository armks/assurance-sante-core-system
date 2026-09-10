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

export async function annulerAvenant(
  id: string,
  avenantId: string,
): Promise<ResultatSimple> {
  const res = await apiFetch(
    `/api/v1/policy/polices/${id}/avenants/${avenantId}/annuler`,
    { method: 'POST' },
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(`${CIBLE}/${id}`);
  return { ok: true };
}
