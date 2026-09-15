'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

const CIBLE = '/dashboard-adherent/individuel';

/**
 * Soumission du questionnaire médical par le souscripteur individuel
 * lui-même — `UnderwritingService.soumettreQuestionnaire` vérifie déjà
 * `estLeSouscripteur(ctx, souscripteurId)`, jamais fait confiance à autre
 * chose que l'identité du compte connecté pour l'autorisation. `societeId`
 * (= son propre `souscripteurId`) vient de `permissions.scope.societeId`,
 * jamais saisi par l'utilisateur.
 */
export async function soumettreMonQuestionnaire(
  societeId: string,
  input: { reponses: Record<string, unknown>; antecedentsDeclares: string[] },
): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/underwriting/questionnaires', {
    method: 'POST',
    body: JSON.stringify({
      souscripteurId: societeId,
      reponses: input.reponses,
      antecedentsDeclares: input.antecedentsDeclares,
    }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Questionnaire soumis — en attente d’évaluation par le médecin souscripteur.' };
}
