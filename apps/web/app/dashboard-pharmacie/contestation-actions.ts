'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

/**
 * Partagée entre `/dashboard-pharmacie/pharmacien/contestations` et
 * `/dashboard-pharmacie/comptable/contestations` (droits identiques côté API,
 * `ROLES_JUSTIFICATION_PHARMACIE`) — `cible` en paramètre plutôt qu'un chemin
 * fixe, même convention que `dispensation-actions.ts`. `fd` porte le champ
 * texte `reponse` ET les fichiers `pieces` (multipart, transmis tel quel à
 * l'API — jamais reconstruit en JSON).
 */
export async function soumettreJustification(
  contestationId: string,
  fd: FormData,
  cible: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/contestation/contestations/${contestationId}/justification`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Justification transmise au pharmacien conseil.' };
}
