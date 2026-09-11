'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';
import type { CodeConsultationGenere } from './types';

const CIBLE = '/dashboard-adherent/consultation';

/** Demande un code de consultation — le code n'est renvoyé qu'ICI, à l'adhérent. */
export async function demanderCode(input: {
  etablissementId: string;
  policeId: string;
}): Promise<ResultatSoumission & { code?: CodeConsultationGenere }> {
  const res = await apiFetch('/api/v1/preauthorization/codes-consultation', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const code = (await res.json()) as CodeConsultationGenere;
  revalidatePath(CIBLE);
  return { ok: true, message: 'Code généré.', code };
}

export async function annulerCode(id: string): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/preauthorization/codes-consultation/${id}/annuler`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Code annulé.' };
}
