'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, messageErreur } from '@/lib/api';

const CIBLE = '/dashboard-adherent/factures';

export async function validerFacturation(code: string): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/preauthorization/codes-facturation/valider', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Code validé — le règlement peut être effectué.' };
}
