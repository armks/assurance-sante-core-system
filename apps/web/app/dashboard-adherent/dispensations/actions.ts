'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, messageErreur } from '@/lib/api';

const CIBLE = '/dashboard-adherent/dispensations';

export async function validerCodeDispensation(code: string): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/pharmacy/dispensations/valider-code', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Code validé — la pharmacie peut enregistrer le paiement.' };
}
