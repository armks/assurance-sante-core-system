'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

const CIBLE = '/dashboard-assureur/medecin-conseil/factures-etablissement';

/** Réservé EXCLUSIVEMENT à ASSUREUR_MEDECIN_CONSEIL côté API. */
export async function verifierFactureMensuelleEtablissement(
  factureMensuelleId: string,
  decision: 'VALIDEE' | 'A_CORRIGER',
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/preauthorization/factures-mensuelles-etablissement/${factureMensuelleId}/verifier`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return {
    ok: true,
    message:
      decision === 'VALIDEE'
        ? 'Facture vérifiée — transmise au comptable.'
        : 'Facture renvoyée à l’établissement pour correction.',
  };
}
