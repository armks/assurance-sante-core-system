'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

const CIBLE = '/dashboard-assureur/medecin-conseil/preautorisations';

/**
 * Décision du médecin conseil sur un acte en attente de pré-autorisation
 * (analyses/examens médicaux). L'API réserve cette action exclusivement à
 * ASSUREUR_MEDECIN_CONSEIL — on relaie seulement.
 */
export async function validerPreautorisation(
  acteId: string,
  input: { decision: 'APPROUVE' | 'REFUSE'; motif: string },
): Promise<ResultatSoumission> {
  const res = await apiFetch(
    `/api/v1/preauthorization/actes/${acteId}/preautorisation`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Décision enregistrée.' };
}
