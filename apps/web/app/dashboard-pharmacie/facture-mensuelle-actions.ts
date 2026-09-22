'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

/**
 * Partagée entre `/dashboard-pharmacie/pharmacien/factures-mensuelles` et
 * `/dashboard-pharmacie/comptable/factures-mensuelles` (droits identiques
 * côté API, `ROLES_FACTURATION_MENSUELLE`) — `cible` en paramètre, même
 * convention que `contestation-actions.ts`.
 */
export async function soumettreFactureMensuelle(
  periode: string,
  cible: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/pharmacy/factures-mensuelles', {
    method: 'POST',
    body: JSON.stringify({ periode }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Facture mensuelle soumise au pharmacien conseil.' };
}
