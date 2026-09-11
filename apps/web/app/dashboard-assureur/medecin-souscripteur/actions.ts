'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';
import type { DecisionQuestionnaire } from '@/lib/underwriting';

const RACINE = '/dashboard-assureur/medecin-souscripteur';

/**
 * Rend la décision médicale sur un questionnaire (réservé côté API à
 * `ASSUREUR_MEDECIN_SOUSCRIPTEUR`).
 */
export async function evaluerQuestionnaire(
  id: string,
  input: {
    decision: DecisionQuestionnaire;
    surprimePourcent?: number;
    exclusionsSpecifiques?: string[];
  },
): Promise<ResultatSoumission> {
  const corps: Record<string, unknown> = { decision: input.decision };
  if (input.decision === 'ACCEPTE_SURPRIME') {
    corps.surprimePourcent = input.surprimePourcent;
  }
  if (input.decision === 'ACCEPTE_AVEC_EXCLUSION') {
    corps.exclusionsSpecifiques = input.exclusionsSpecifiques ?? [];
  }

  const res = await apiFetch(`/api/v1/underwriting/questionnaires/${id}/evaluer`, {
    method: 'POST',
    body: JSON.stringify(corps),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };

  revalidatePath(`${RACINE}/${id}`);
  revalidatePath(RACINE);
  return { ok: true, message: 'Décision enregistrée.' };
}
