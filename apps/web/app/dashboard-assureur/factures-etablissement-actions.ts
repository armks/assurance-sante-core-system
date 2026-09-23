'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

/**
 * Partagée entre `/dashboard-assureur/comptable/factures-etablissement` et
 * `/dashboard-assureur/comptable-adjoint/factures-etablissement` (droits
 * identiques côté API) — `cible` en paramètre, même convention que
 * `factures-pharmacie-actions.ts`.
 */
export async function validerPourPaiementEtablissement(
  factureMensuelleId: string,
  cible: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch(
    `/api/v1/preauthorization/factures-mensuelles-etablissement/${factureMensuelleId}/valider-pour-paiement`,
    { method: 'POST' },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Facture validée pour paiement.' };
}

export async function marquerFactureMensuelleEtablissementPayee(
  factureMensuelleId: string,
  cible: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch(
    `/api/v1/preauthorization/factures-mensuelles-etablissement/${factureMensuelleId}/marquer-payee`,
    { method: 'POST' },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Facture marquée payée.' };
}
