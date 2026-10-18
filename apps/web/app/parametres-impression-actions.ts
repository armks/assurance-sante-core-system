'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';
import type { ParametresImpression } from './parametres-impression-types';

/** Pages de paramétrage autorisées à être rafraîchies (jamais un chemin fourni tel quel par le navigateur). */
const PAGES = [
  '/dashboard-centre-medical/parametres-impression',
  '/dashboard-pharmacie/pharmacien/parametres-impression',
  '/dashboard-pharmacie/caissiere/parametres-impression',
  '/dashboard-pharmacie/comptable/parametres-impression',
];

export async function enregistrerParametresImpression(
  input: { typeImprimante: string; enTete: string; piedPage: string; identifiantFiscal: string; afficherDetail: boolean },
  page: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/recus/parametres', {
    method: 'PUT',
    body: JSON.stringify({
      typeImprimante: input.typeImprimante,
      enTete: input.enTete,
      piedPage: input.piedPage,
      identifiantFiscal: input.identifiantFiscal,
      afficherDetail: input.afficherDetail,
    }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  if (PAGES.includes(page)) revalidatePath(page);
  return { ok: true, message: 'Paramètres d’impression enregistrés.' };
}

export type { ParametresImpression };
