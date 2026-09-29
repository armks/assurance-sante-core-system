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
 * Validation d'un adhérent PRINCIPAL (jamais un `Beneficiaire`) — réservée
 * EXCLUSIVEMENT à ASSUREUR_EXPLOITATION (pas DIRECTION/INFORMATIQUE, qui
 * peuvent pourtant créer l'adhérent via `ROLES_GESTION_MEMBRE` — la création
 * et la validation sont deux étapes distinctes). Gouverne la coupure de
 * facturation mensuelle (`BillingService.genererCotisationsPeriode`,
 * prisma/sql/052) : `Adherent.dateValidation` doit être antérieure au 1er du
 * mois facturé pour que l'adhérent y soit inclus.
 */
export const ROLE_VALIDATION_ADHERENT = 'ASSUREUR_EXPLOITATION';

/**
 * Import en masse d'adhérents depuis un fichier Excel (prisma/sql/053) —
 * réservé à ASSUREUR_INFORMATIQUE et ASSUREUR_COMPTABLE (cohérents avec
 * `ROLES_GESTION_SOUSCRIPTEUR`, tenant.types.ts). L'import ne crée AUCUN
 * adhérent — seule `validerImportAdherents` (rôles distincts ci-dessous) le fait.
 */
export const ROLES_IMPORT_ADHERENTS = ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_COMPTABLE'] as const;

/**
 * Validation d'un import d'adhérents — réservée à ASSUREUR_INFORMATIQUE et
 * ASSUREUR_EXPLOITATION (jamais ASSUREUR_COMPTABLE, qui peut pourtant
 * importer le fichier — création et validation restent deux étapes
 * distinctes, même principe que `ROLE_VALIDATION_ADHERENT`).
 */
export const ROLES_VALIDATION_IMPORT_ADHERENTS = ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_EXPLOITATION'] as const;

/** `BROUILLON` ajouté (prisma/sql/054) : propositions société éditables une à
 * une, avant « Soumettre pour validation » — jamais atteint par un import
 * Excel de l'informatique, qui saute directement en EN_ATTENTE_VALIDATION. */
export const STATUTS_IMPORT_ADHERENTS = ['BROUILLON', 'EN_ATTENTE_VALIDATION', 'VALIDE', 'REJETE'] as const;

/**
 * Propositions collaboratives d'ajout d'adhérents/bénéficiaires par une
 * société cliente (prisma/sql/054) — réservé à SOCIETE_ASSUREE et
 * SOCIETE_ADMINISTRATION (élargi par rapport à `ROLE_GESTION_MEMBRE_SOCIETE`,
 * seul habilité à créer un adhérent DIRECTEMENT via `creerAdherent` : une
 * simple PROPOSITION, encore soumise à validation assureur, est un risque
 * moindre que la création immédiate). Toujours scopé à SA PROPRE société
 * (`ctx.societeId === souscripteurId`), même principe que `assertGestion`.
 */
export const ROLES_PROPOSITION_ADHERENTS_SOCIETE = ['SOCIETE_ASSUREE', 'SOCIETE_ADMINISTRATION'] as const;

/**
 * Double validation d'un bénéficiaire proposé par l'ADHÉRENT lui-même
 * (prisma/sql/055, distinct des propositions société ci-dessus) : d'abord
 * `SOCIETE_ADMINISTRATION` (`ROLE_GESTION_MEMBRE_SOCIETE`, réutilisé —
 * EN_ATTENTE_SOCIETE → EN_ATTENTE_ASSUREUR), puis l'un de ces deux rôles
 * ASSUREUR (EN_ATTENTE_ASSUREUR → ACTIF, `numero_carte` attribué et carte
 * générée à ce moment précis, jamais avant). Additif : la création DIRECTE
 * d'un bénéficiaire par SOCIETE_ADMINISTRATION/ASSUREUR (`ajouterBeneficiaire`,
 * déjà existante) reste inchangée — statut ACTIF et carte immédiats.
 */
export const STATUT_BENEFICIAIRE_EN_ATTENTE_SOCIETE = 'EN_ATTENTE_SOCIETE';
export const STATUT_BENEFICIAIRE_EN_ATTENTE_ASSUREUR = 'EN_ATTENTE_ASSUREUR';
export const ROLES_VALIDATION_BENEFICIAIRE_ASSUREUR = ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_EXPLOITATION'] as const;

/**
 * Photo de profil (adhérent ou bénéficiaire, prisma/sql/055) — bucket privé
 * `photos` (même recette que `cartes`, prisma/sql/023). Donnée non
 * structurante : modifiable par l'adhérent sans validation, y compris pour
 * un bénéficiaire encore EN_ATTENTE_SOCIETE/EN_ATTENTE_ASSUREUR.
 */
export const TAILLE_MAX_PHOTO_OCTETS = 5 * 1024 * 1024;
/**
 * Personnel habilité à ajouter/modifier la photo d'un adhérent ou d'un de ses
 * bénéficiaires depuis l'écran de gestion — EN PLUS du self-service de
 * l'adhérent (jamais à sa place). Toujours scopé à l'organisation de
 * l'appelant (`chargerAdherent`). Mêmes conventions de nommage et de dossier
 * famille que le self-service.
 */
export const ROLES_PHOTO_PERSONNEL = ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_EXPLOITATION'] as const;
export const MIME_TYPES_PHOTO_AUTORISES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Mouvements de personnel — SORTANTS (prisma/sql/056). Proposition réservée
 * EXCLUSIVEMENT à SOCIETE_ADMINISTRATION (pas SOCIETE_ASSUREE, contrairement
 * aux propositions d'AJOUT ci-dessus — un mouvement de sortie est un risque
 * plus élevé qu'une simple proposition d'ajout). `statut` de l'adhérent passe
 * IMMÉDIATEMENT à `PROPOSE_SORTANT` (visible sans délai), effectif
 * (SUSPENDU/RADIE, `statutSortantCible`) seulement après validation par
 * `ROLES_VALIDATION_IMPORT_ADHERENTS` (réutilisé tel quel — même rôles que la
 * validation d'un import). Effet IMMÉDIAT une fois validé — aucun report au
 * mois suivant (à la différence des entrants, cf. plus bas) : le prompt ne le
 * demande que pour les entrants.
 */
export const ROLE_PROPOSITION_SORTANT_SOCIETE = 'SOCIETE_ADMINISTRATION';
export const STATUT_ADHERENT_PROPOSE_SORTANT = 'PROPOSE_SORTANT';
export const STATUTS_SORTANT_CIBLE = ['SUSPENDU', 'RADIE'] as const;

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
