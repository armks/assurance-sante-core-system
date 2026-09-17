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

/**
 * Identification par numéro de carte à l'accueil du centre médical — ADDITIF
 * au code de consultation, ne le remplace pas. Purement informatif (statut
 * ACTIF/SUSPENDU/RADIE) : n'ouvre aucun dossier, ne crée rien. Réservé à
 * CENTRE_MEDICAL_ACCUEIL exclusivement (pas les autres rôles CENTRE_MEDICAL_*,
 * ni le personnel ASSUREUR — cf. instruction explicite).
 */
export const ROLE_RECHERCHE_CARTE = 'CENTRE_MEDICAL_ACCUEIL';

/** `sous_roles.entite_code` des 4 rôles société affiliée (v9 §ADDENDUM). */
export const ENTITE_SOCIETE_AFFILIEE = 'SOCIETE_AFFILIEE';

/**
 * `sous_roles.entite_code` des rôles adhérent (`ADHERENT_TITULAIRE`,
 * `SOUSCRIPTEUR_INDIVIDUEL` — v9 §ADDENDUM). Un compte de cette entité ne voit
 * et ne gère jamais que SON PROPRE enregistrement `adherents` (`ctx.adherentId`),
 * même par ID direct — fuite corrigée lors de l'audit du dashboard adhérent
 * (même famille que le scope `ENTITE_SOCIETE_AFFILIEE` ci-dessus).
 */
export const ENTITE_ADHERENT = 'ADHERENT';

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  roleChain: string[];
  /** `profils.societe_id` — renseigné pour les rôles SOCIETE_*. */
  societeId: string | null;
  /** `sous_roles.entite_code` du rôle propre — scope la LECTURE pour tout rôle
   * SOCIETE_AFFILIEE (pas seulement SOCIETE_ADMINISTRATION, qui seul écrit). */
  entite: string | null;
  /** `profils.adherent_id` — renseigné pour les rôles ADHERENT (self-service). */
  adherentId: string | null;
}
