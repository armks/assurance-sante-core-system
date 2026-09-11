'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';
import type { CodeOrdonnancePharmacie } from './types';

/**
 * Actions partagées PHARMACIE_PHARMACIEN / PHARMACIE_CAISSIERE — mêmes droits
 * réels côté API (ROLES_PHARMACIE ne distingue pas les 2 rôles sur ces 2
 * endpoints, vérifié explicitement avant de construire cet écran).
 */

export async function validerCode(
  code: string,
  pharmacieId: string,
  cible: string,
): Promise<ResultatSoumission & { ordonnance?: CodeOrdonnancePharmacie['ordonnance'] }> {
  const res = await apiFetch('/api/v1/preauthorization/codes-ordonnance/valider', {
    method: 'POST',
    body: JSON.stringify({ code, pharmacieId }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const body = (await res.json()) as { ordonnance: CodeOrdonnancePharmacie['ordonnance'] };
  revalidatePath(cible);
  return { ok: true, message: 'Code validé — contenu de l’ordonnance révélé.', ordonnance: body.ordonnance };
}

export async function marquerDispense(
  codeId: string,
  input: { type: 'PARTIELLE' | 'COMPLETE'; commentaire?: string },
  cible: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/preauthorization/codes-ordonnance/${codeId}/dispensation`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Dispensation enregistrée.' };
}
