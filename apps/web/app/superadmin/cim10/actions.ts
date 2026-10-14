'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

const CIBLE = '/superadmin/cim10';

type Resultat = { ok: true; message?: string } | { ok: false; error: string };

export interface ResumeImportCim10 {
  lignesLues: number;
  crees: number;
  modifies: number;
  inchanges: number;
  nbErreurs: number;
  erreurs: { ligne: number; contenu: string; raison: string }[];
}

export async function creerMaladieCim10(input: { code: string; libelle: string }): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/cim10', { method: 'POST', body: JSON.stringify(input) });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: `Maladie « ${input.code.toUpperCase()} » ajoutée.` };
}

export async function modifierMaladieCim10(id: string, input: { libelle: string }): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/cim10/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Maladie modifiée.' };
}

export async function changerStatutMaladieCim10(id: string, action: 'desactiver' | 'reactiver'): Promise<Resultat> {
  const res = await apiFetch(`/api/v1/cim10/${id}/${action}`, { method: 'POST' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  return { ok: true, message: action === 'desactiver' ? 'Maladie désactivée.' : 'Maladie réactivée.' };
}

export async function supprimerMaladieCim10(id: string): Promise<Resultat> {
  const res = await apiFetch(`/api/v1/cim10/${id}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Maladie supprimée.' };
}

export async function importerMaladiesCim10(
  fd: FormData,
): Promise<{ ok: true; resume: ResumeImportCim10 } | { ok: false; error: string; erreurs: string[] }> {
  const res = await apiFetch('/api/v1/cim10/import', { method: 'POST', body: fd });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, resume: await res.json() };
}
