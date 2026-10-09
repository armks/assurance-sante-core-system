'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

const CIBLE = '/superadmin/lettres-cles';

type Resultat = { ok: true; message?: string } | { ok: false; error: string };

/** Lettres-clés de la nomenclature — aucune valeur chiffrée (les valeurs se négocient par établissement). */
export async function creerLettreCle(input: { code: string; libelle: string; ordre?: number }): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/superadmin/lettres-cles', { method: 'POST', body: JSON.stringify(input) });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: `Lettre-clé « ${input.code.toUpperCase()} » créée.` };
}

export async function modifierLettreCle(id: string, input: { libelle?: string; ordre?: number }): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/superadmin/lettres-cles/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Lettre-clé modifiée.' };
}

export async function changerStatutLettreCle(id: string, action: 'desactiver' | 'reactiver'): Promise<Resultat> {
  const res = await apiFetch(`/api/v1/superadmin/lettres-cles/${id}/${action}`, { method: 'POST' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  return { ok: true, message: action === 'desactiver' ? 'Lettre-clé désactivée.' : 'Lettre-clé réactivée.' };
}

export async function supprimerLettreCle(id: string): Promise<Resultat> {
  const res = await apiFetch(`/api/v1/superadmin/lettres-cles/${id}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Lettre-clé supprimée.' };
}
