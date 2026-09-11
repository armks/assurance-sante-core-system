/**
 * Constantes du questionnaire médical / tarification individuelle — MIROIR de
 * `apps/api/src/underwriting/underwriting.types.ts`. Sert à l'affichage ;
 * l'API (`UnderwritingService`) reste seule juge des accès et des règles.
 */

export const ROLE_MEDECIN_SOUSCRIPTEUR = 'ASSUREUR_MEDECIN_SOUSCRIPTEUR';

export const DECISIONS_QUESTIONNAIRE = [
  'ACCEPTE',
  'ACCEPTE_AVEC_EXCLUSION',
  'ACCEPTE_SURPRIME',
  'REFUSE',
] as const;
export type DecisionQuestionnaire = (typeof DECISIONS_QUESTIONNAIRE)[number];

export const LIBELLE_DECISION: Record<string, string> = {
  ACCEPTE: 'Accepté',
  ACCEPTE_AVEC_EXCLUSION: 'Accepté avec exclusion',
  ACCEPTE_SURPRIME: 'Accepté avec surprime',
  REFUSE: 'Refusé',
};

/** Tonalité forcée par jeton (StatutBadge `map`). */
export const TON_DECISION: Record<
  string,
  'succes' | 'attention' | 'danger' | 'info' | 'neutre'
> = {
  EN_ATTENTE: 'attention',
  ACCEPTE: 'succes',
  ACCEPTE_AVEC_EXCLUSION: 'info',
  ACCEPTE_SURPRIME: 'info',
  REFUSE: 'danger',
};

/** Jeton de statut d'un questionnaire : sa décision, ou `EN_ATTENTE`. */
export function statutQuestionnaire(decision: string | null): string {
  return decision ?? 'EN_ATTENTE';
}

export const LIBELLE_STATUT_QUESTIONNAIRE: Record<string, string> = {
  EN_ATTENTE: 'En attente d’évaluation',
  ...LIBELLE_DECISION,
};
