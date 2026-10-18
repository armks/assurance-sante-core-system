'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, detailErreur } from '@/lib/api';

export type ResultatActivation = { ok: true; message: string } | { ok: false; error: string };

/**
 * Active ou renouvelle la licence de la société avec le code temporaire transmis par le superadmin. Réservé (côté API) à
 * l'informatique et à la direction de l'assureur ; le code est à usage unique et valable 24 h.
 */
export async function activerLicence(code: string): Promise<ResultatActivation> {
  const res = await apiFetch('/api/v1/licences/activer', { method: 'POST', body: JSON.stringify({ code }) });
  if (!res.ok) return { ok: false, error: (await detailErreur(res)).error };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Licence activée : l’accès à l’application est rétabli.' };
}
