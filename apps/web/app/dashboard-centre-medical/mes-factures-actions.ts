'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

/** Nouveau code de facturation (le précédent a expiré) : l'adhérent le retrouve dans son espace. */
export async function renouvelerCodeFacturation(factureId: string): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/preauthorization/factures/${factureId}/renouveler-code`, { method: 'POST' });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath('/dashboard-centre-medical/mes-factures');
  return { ok: true, message: 'Nouveau code généré : l’adhérent le voit dans son espace (valable 24 h).' };
}
