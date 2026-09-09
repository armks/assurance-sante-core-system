export const STATUTS_DOSSIER = [
  'OUVERT',
  'SUSPENDU',
  'TRANSFERE',
  'CLOTURE',
  'FORCE_CLOS',
] as const;
export type StatutDossier = (typeof STATUTS_DOSSIER)[number];

export const STATUTS_CONSULTATION = [
  'EN_COURS',
  'TERMINEE',
  'ANNULEE',
] as const;
export type StatutConsultation = (typeof STATUTS_CONSULTATION)[number];

export const ROLE_MEDECIN_TRAITANT = 'CENTRE_MEDICAL_MEDECIN';

/** Rôles autorisés à ouvrir / gérer un dossier de soins. */
export const ROLES_GESTION_DOSSIER = [
  'CENTRE_MEDICAL_ACCUEIL',
  'CENTRE_MEDICAL_MEDECIN',
  'CENTRE_MEDICAL_ADMINISTRATIF',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_INFORMATIQUE',
] as const;

/** La clôture forcée est réservée à ASSUREUR_EXPLOITATION (v1 §15). */
export const ROLE_CLOTURE_FORCEE = 'ASSUREUR_EXPLOITATION';

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  roleChain: string[];
}

/** Résultat détaillé du MoteurOuvertureDossier — blocages jamais génériques. */
export interface EvaluationOuverture {
  carteValide: boolean;
  adherentEligible: boolean;
  aucunDossierOuvert: boolean;
  horsDelaiCarence: boolean;
  blocages: string[];
}
