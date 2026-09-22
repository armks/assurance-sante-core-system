'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

const CIBLE = '/dashboard-assureur/pharmacien-conseil/prescriptions';

/** Réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_CONSEIL côté API. */
export async function ouvrirContestation(
  ligneOrdonnanceId: string,
  motif: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/contestation/contestations', {
    method: 'POST',
    body: JSON.stringify({ ligneOrdonnanceId, motif }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Contestation ouverte.' };
}

/** Réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_CONSEIL côté API. */
export async function trancherContestation(
  contestationId: string,
  decision: 'VALIDEE' | 'REJETEE',
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/contestation/contestations/${contestationId}/trancher`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return {
    ok: true,
    message: decision === 'VALIDEE' ? 'Contestation validée — ligne débloquée.' : 'Contestation rejetée — ligne définitivement exclue.',
  };
}
