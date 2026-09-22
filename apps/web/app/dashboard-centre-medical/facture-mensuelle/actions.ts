'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

const CIBLE = '/dashboard-centre-medical/facture-mensuelle';

/** Réservé à CENTRE_MEDICAL_COMPTABLE/CENTRE_MEDICAL_ADMINISTRATIF côté API. */
export async function soumettreFactureMensuelleEtablissement(periode: string): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/preauthorization/factures-mensuelles-etablissement', {
    method: 'POST',
    body: JSON.stringify({ periode }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Facture provisoire soumise au médecin conseil.' };
}
