'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

const CIBLE = '/dashboard-assureur/pharmacien-conseil/factures-mensuelles';

/** Réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_CONSEIL côté API — double
 * vérification anti-litige avant de débloquer la facture pour le comptable,
 * ou renvoi à la pharmacie pour correction (A_CORRIGER). */
export async function validerFactureMensuelle(
  factureMensuelleId: string,
  decision: 'VALIDEE' | 'A_CORRIGER',
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/pharmacy/factures-mensuelles/${factureMensuelleId}/valider`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return {
    ok: true,
    message:
      decision === 'VALIDEE'
        ? 'Facture validée — débloquée pour le comptable.'
        : 'Facture renvoyée à la pharmacie pour correction.',
  };
}
