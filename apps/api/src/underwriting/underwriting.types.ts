export const DECISIONS_QUESTIONNAIRE = [
  'ACCEPTE',
  'ACCEPTE_AVEC_EXCLUSION',
  'ACCEPTE_SURPRIME',
  'REFUSE',
] as const;
export type DecisionQuestionnaire = (typeof DECISIONS_QUESTIONNAIRE)[number];

/**
 * SÉPARATION STRICTE (v10 §3) : SEUL ce sous-rôle peut lire / évaluer la décision
 * médicale. `ASSUREUR_MEDECIN_CONSEIL` n'a AUCUN accès (rôle distinct, sans
 * parenté — `profil_a_role` le renvoie donc false, et le service le refuse).
 */
export const ROLE_MEDECIN_SOUSCRIPTEUR = 'ASSUREUR_MEDECIN_SOUSCRIPTEUR';

/** Rôles autorisés à produire une tarification individuelle (prime + surprime). */
export const ROLES_TARIFICATION_INDIVIDUELLE = [
  'ASSUREUR_DIRECTION',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_MEDECIN_SOUSCRIPTEUR',
  'ASSUREUR_INFORMATIQUE',
] as const;

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  entite: string | null;
  societeId: string | null;
  roleChain: string[];
}
