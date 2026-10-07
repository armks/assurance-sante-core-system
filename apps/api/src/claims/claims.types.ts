export const STATUTS_RECLAMATION = [
  'SOUMISE',
  'EN_ADJUDICATION',
  'AUTO_ADJUDIQUE',
  'REVUE_MANUELLE',
  'REJETE',
  'PAYEE',
] as const;
export type StatutReclamation = (typeof STATUTS_RECLAMATION)[number];

export const TYPES_RECLAMATION = [
  'SOIN',
  'PHARMACIE',
  'HOSPITALISATION',
  'OPTIQUE',
  'DENTAIRE',
  'ANALYSES',
  'IMAGERIE',
  'AUTRE',
] as const;
export type TypeReclamation = (typeof TYPES_RECLAMATION)[number];

/**
 * Rôles ASSUREUR habilités à soumettre une réclamation à l'adjudication.
 * (Seule défense réelle contre un appel direct : `postgres` a `BYPASSRLS`,
 * voir ADR-002 dans ARCHITECTURE-DECISIONS.md — les policies RLS ne protègent
 * PAS ce chemin, uniquement un éventuel accès direct `authenticated`.)
 */
export const ROLES_GESTION_CLAIMS = [
  'ASSUREUR_DIRECTION',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_INFORMATIQUE',
] as const;

/** Le seul statut depuis lequel `soumettre` verrouille — tout le reste est « au-delà ». */
export const STATUT_INITIAL: StatutReclamation = 'SOUMISE';
export const STATUT_VERROUILLE: StatutReclamation = 'EN_ADJUDICATION';

// --- Revue manuelle (statut REVUE_MANUELLE) ---------------------------

export const DECISIONS_REVUE_MANUELLE = ['APPROUVE', 'REJETE'] as const;
export type DecisionRevueManuelle = (typeof DECISIONS_REVUE_MANUELLE)[number];

/**
 * Rôle de revue manuelle : lu dans le référentiel `categories_acte.role_revue`
 * (prisma/sql/067) depuis la catégorie de la source — plus de table type →
 * rôle ici. `ASSUREUR_DIRECTION` peut traiter toutes les revues (supervision).
 * `ROLE_REVUE_FINANCIERE` sert de repli si la catégorie est introuvable.
 */
export const ROLE_REVUE_MEDICALE = 'ASSUREUR_MEDECIN_CONSEIL';
export const ROLE_REVUE_FINANCIERE = 'ASSUREUR_EXPLOITATION';
export const ROLE_REVUE_SUPERVISION = 'ASSUREUR_DIRECTION';

/**
 * Rôles habilités à CONSULTER les réclamations (`GET /claims/reclamations`
 * et `/:id`) — données de santé sensibles. `ROLES_GESTION_CLAIMS` + le
 * médecin-conseil (revue médicale, ne soumet jamais mais doit pouvoir lister
 * et lire une réclamation `REVUE_MANUELLE` avant `validerManuellement`).
 * AUCUN rôle SOCIETE_* : `reclamations` n'a pas de colonne société/souscripteur
 * (voir PROGRESSION.md, gap noté au prompt filière SOCIETE_AFFILIEE) — tant
 * que ce scoping n'existe pas, la lecture reste réservée au personnel ASSUREUR.
 */
export const ROLES_LECTURE_CLAIMS = [
  ...ROLES_GESTION_CLAIMS,
  ROLE_REVUE_MEDICALE,
] as const;

/**
 * Rôles ADHERENT (entité `ADHERENT`, v9 §ADDENDUM) autorisés à lire LEURS
 * PROPRES réclamations (`GET /claims/reclamations`, `/:id`) — scope strict sur
 * `adherentId`, jamais l'organisation entière (voir `ClaimsService.modeLecture`).
 * Dupliqué localement plutôt qu'importé de `preauthorization` : un module =
 * un domaine métier strict (règle transverse du skill).
 */
export const ROLES_ADHERENT_CLAIMS = [
  'ADHERENT_TITULAIRE',
  'SOUSCRIPTEUR_INDIVIDUEL',
] as const;

/**
 * Rôles SOCIETE (entité `SOCIETE_AFFILIEE`) autorisés à lire les réclamations
 * de LEURS PROPRES adhérents (écran « Réclamations » société cliente, prompt
 * dédié gestion collaborative). `reclamations` n'a pas de colonne société —
 * le scope est dérivé via `adherentId IN (adherents.id WHERE souscripteurId =
 * ctx.societeId)`, voir `ClaimsService.adherentIdsSociete`/`modeLecture`.
 * Cohérent avec la policy RLS `reclamations_lecture_societe` (prisma/sql/054).
 * Dupliqué localement (même principe que `ROLES_ADHERENT_CLAIMS` ci-dessus).
 */
export const ROLES_SOCIETE_CLAIMS = [
  'SOCIETE_ASSUREE',
  'SOCIETE_ADMINISTRATION',
] as const;

/** Code ajouté à `codes_rejet` quand un rejet est prononcé après revue manuelle. */
export const CODE_REJET_MANUEL = 'REJET_MANUEL';

/** Rejet posé par NestJS, sans adjudication : la catégorie de l'acte n'a pas
 * de garantie dans le produit (règle « non couvert », prisma/sql/067). */
export const CODE_REJET_CATEGORIE_NON_COUVERTE = 'E011';

/** Catégorie (référentiel `categories_acte`) d'une réclamation issue d'une dispensation. */
export const CATEGORIE_ACTE_DISPENSATION = 'PHARMACIE';

/**
 * Libellés des codes de rejet / de mise en revue (nomenclature v3 §4 / v8,
 * E001, E006, E010 et E012–E014 émis par l'adjudicateur ; E011 par le core).
 */
export const LIBELLE_CODE_REJET: Record<string, string> = {
  E001: 'La police ne couvrait pas la date des soins (suspendue, pas encore en vigueur, ou soins après sa fin)',
  E006: 'Plafond annuel de la garantie atteint ou dépassé pour cet adhérent',
  E010: "Montant remboursé au-dessus du seuil d'adjudication automatique",
  E011: "Catégorie d'acte non couverte par le produit",
  E012: 'Soins antérieurs à la date de début de la police',
  E013: 'Date des soins postérieure à la date de déclaration (soins dans le futur)',
  E014: 'Soins déclarés après le délai suivant la fin de la police',
  ADJ_ECHEC:
    "Échec temporaire de l'appel au microservice d'adjudication — réclamation à re-soumettre",
  REJET_MANUEL: 'Rejet prononcé après revue manuelle',
};

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  roleChain: string[];
  /** `profils.adherent_id` — renseigné pour les rôles ADHERENT (self-service). */
  adherentId: string | null;
  /** `profils.societe_id` — renseigné pour les rôles SOCIETE_*. */
  societeId: string | null;
}
