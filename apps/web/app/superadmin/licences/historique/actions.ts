'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, detailErreur } from '@/lib/api';

export type ResultatTarif = { ok: true; message: string } | { ok: false; error: string };

/** Modifie le prix d'un type de licence (FCFA). Ne vaut que pour les licences générées ensuite : l'historique garde son prix. */
export async function definirPrixLicence(typeLicence: string, prix: number): Promise<ResultatTarif> {
  if (!Number.isFinite(prix) || prix < 0) return { ok: false, error: 'Prix invalide.' };
  const res = await apiFetch(`/api/v1/superadmin/licences/tarifs/${typeLicence}`, { method: 'PUT', body: JSON.stringify({ prix }) });
  if (!res.ok) return { ok: false, error: (await detailErreur(res)).error };
  revalidatePath('/superadmin/licences/historique');
  revalidatePath('/superadmin/licences');
  return { ok: true, message: 'Prix enregistré (valable pour les prochaines licences).' };
}
