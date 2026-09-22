'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

const CIBLE = '/dashboard-centre-medical/contestations';

/**
 * Réservée à CENTRE_MEDICAL_MEDECIN/COMPTABLE/ADMINISTRATIF de l'établissement
 * concerné côté API (jamais ACCUEIL). `fd` porte le champ texte `reponse` ET
 * les fichiers `pieces` (multipart, transmis tel quel — jamais reconstruit en
 * JSON), même convention que côté pharmacie.
 */
export async function soumettreJustificationActe(
  contestationId: string,
  fd: FormData,
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/contestation/contestations-actes/${contestationId}/justification`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Justification transmise au médecin conseil.' };
}
