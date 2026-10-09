'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

const CIBLE = '/dashboard-centre-medical/tarifs-proposes';

/**
 * Propose un montant pour un acte non tarifable (comptable ou administratif de l'établissement ; l'API reste
 * seule juge : établissement, acte réellement non tarifable, une seule proposition à la fois).
 */
export async function proposerTarif(corps: {
  acteDossierId: string;
  montantPropose: number;
  justification: string;
}): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/tarifs-proposes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Tarif proposé : il sera examiné par le médecin conseil.' };
}
