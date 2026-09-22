'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

/**
 * Partagée entre `/dashboard-assureur/comptable/factures-pharmacie` et
 * `/dashboard-assureur/comptable-adjoint/factures-pharmacie` (droits
 * identiques côté API) — `cible` en paramètre, même convention que
 * `preautorisation-exploitation-actions.ts`.
 */
export async function programmerPaiementFactureMensuelle(
  factureMensuelleId: string,
  cible: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch(
    `/api/v1/pharmacy/factures-mensuelles/${factureMensuelleId}/programmer-paiement`,
    { method: 'POST' },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Paiement programmé.' };
}

export async function marquerFactureMensuellePayee(
  factureMensuelleId: string,
  cible: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch(
    `/api/v1/pharmacy/factures-mensuelles/${factureMensuelleId}/marquer-payee`,
    { method: 'POST' },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Facture marquée payée.' };
}
