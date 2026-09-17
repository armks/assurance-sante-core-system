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

/**
 * Choisi UNE FOIS, à l'intérieur du dossier, après son ouverture (jamais
 * avant — l'ouverture reste conditionnée au seul code de consultation,
 * inchangée). prisma/sql/036.
 */
export const TYPES_VISITE = [
  'CONSULTATION_GENERALISTE',
  'CONSULTATION_SPECIALISTE',
  'HOSPITALISATION_MEDICALE',
  'ANALYSES_EXAMENS_MEDICAUX',
  'ACTES_DENTAIRES',
  'CONSULTATION_DENTAIRE',
  'PRESCRIPTION_MEDICALE',
] as const;
export type TypeVisite = (typeof TYPES_VISITE)[number];

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

/**
 * Rôles « personnel de centre médical » — soumis au contrôle d'établissement
 * (fuite inter-établissement corrigée, audit dashboard administratif) :
 * `ajouterConsultation`/`clotureNormale`/`clotureForcee` ne vérifiaient QUE
 * `organisationId`, jamais que l'APPELANT appartenait à l'établissement du
 * dossier — un compte de n'importe quel établissement du réseau pouvait
 * clôturer ou modifier le dossier d'un autre établissement. Dupliqué
 * localement (même valeur que `preauthorization.types.ts`), cohérent avec la
 * règle « un module = un domaine ».
 */
export const ROLES_CENTRE_MEDICAL = [
  'CENTRE_MEDICAL_MEDECIN',
  'CENTRE_MEDICAL_ACCUEIL',
  'CENTRE_MEDICAL_ADMINISTRATIF',
  'CENTRE_MEDICAL_COMPTABLE',
] as const;

/**
 * Rôles ASSUREUR habilités à lire TOUS les dossiers de soins de
 * l'organisation (supervision / revue médicale) — plus large que
 * `ROLES_GESTION_DOSSIER` (qui ne couvre que l'écriture), cohérent avec le
 * pattern déjà établi pour `ROLES_LECTURE_CLAIMS` (claims.types.ts).
 */
export const ROLES_LECTURE_DOSSIER_STAFF = [
  'ASSUREUR_DIRECTION',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_INFORMATIQUE',
  'ASSUREUR_MEDECIN_CONSEIL',
] as const;

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  roleChain: string[];
  /** `profils.etablissement_id` — renseigné pour les rôles CENTRE_MEDICAL. */
  etablissementId: string | null;
}

/** Résultat détaillé du MoteurOuvertureDossier — blocages jamais génériques. */
export interface EvaluationOuverture {
  carteValide: boolean;
  adherentEligible: boolean;
  aucunDossierOuvert: boolean;
  horsDelaiCarence: boolean;
  blocages: string[];
}
