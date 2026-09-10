/**
 * Types du module `member/` — adhérents (titulaires) et bénéficiaires (ayants
 * droit). v9 phase 3, PROMPT 12.
 */

export const STATUTS_MEMBRE = ['ACTIF', 'SUSPENDU', 'RADIE'] as const;
export type StatutMembre = (typeof STATUTS_MEMBRE)[number];

/** Seul `ACTIF` ouvre des droits (parcours de soins, réclamations). */
export const STATUT_MEMBRE_ELIGIBLE: StatutMembre = 'ACTIF';

export const SEXES = ['M', 'F'] as const;
export type Sexe = (typeof SEXES)[number];

export const LIENS_PARENTE = [
  'CONJOINT',
  'ENFANT',
  'PERE',
  'MERE',
  'AUTRE',
] as const;
export type LienParente = (typeof LIENS_PARENTE)[number];

export const MODES_PAIEMENT = ['MOBILE_MONEY', 'VIREMENT_BANCAIRE'] as const;
export type ModePaiement = (typeof MODES_PAIEMENT)[number];

/**
 * Rôles autorisés à gérer le fichier des membres. Cohérent avec la policy RLS
 * `adherents_ecriture` (prisma/sql/022) et la hiérarchie de provisioning
 * (prisma/sql/003) : le personnel ASSUREUR habilité, plus SOCIETE_ADMINISTRATION
 * pour ses propres adhérents (vérifié à part, périmètre souscripteur).
 */
export const ROLES_GESTION_MEMBRE = [
  'ASSUREUR_DIRECTION',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_INFORMATIQUE',
] as const;

export const ROLE_GESTION_MEMBRE_SOCIETE = 'SOCIETE_ADMINISTRATION';

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  roleChain: string[];
  /** `profils.societe_id` — renseigné pour les rôles SOCIETE_*. */
  societeId: string | null;
}
