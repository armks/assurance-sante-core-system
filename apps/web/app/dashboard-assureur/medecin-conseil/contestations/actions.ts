'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

const CIBLE = '/dashboard-assureur/medecin-conseil/contestations';

/** Réservé EXCLUSIVEMENT à ASSUREUR_MEDECIN_CONSEIL côté API. */
export async function ouvrirContestationActe(
  acteDossierId: string,
  motif: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/contestation/contestations-actes', {
    method: 'POST',
    body: JSON.stringify({ acteDossierId, motif }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Contestation ouverte.' };
}

/** Réservé EXCLUSIVEMENT à ASSUREUR_MEDECIN_CONSEIL côté API. */
export async function trancherContestationActe(
  contestationId: string,
  decision: 'VALIDEE' | 'REJETEE',
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/contestation/contestations-actes/${contestationId}/trancher`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return {
    ok: true,
    message: decision === 'VALIDEE' ? 'Contestation validée — acte débloqué.' : 'Contestation rejetée — acte définitivement exclu.',
  };
}
