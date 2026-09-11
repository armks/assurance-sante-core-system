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
 * Types de réclamation à contenu médical → revue par `ASSUREUR_MEDECIN_CONSEIL`.
 * Les autres (`AUTRE`) → `ASSUREUR_EXPLOITATION`. `ASSUREUR_DIRECTION` peut traiter
 * les deux (rôle de supervision, `peut_valider`).
 */
export const TYPES_RECLAMATION_MEDICAUX = [
  'SOIN',
  'PHARMACIE',
  'HOSPITALISATION',
  'OPTIQUE',
  'DENTAIRE',
  'ANALYSES',
  'IMAGERIE',
] as const;

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

/** Code ajouté à `codes_rejet` quand un rejet est prononcé après revue manuelle. */
export const CODE_REJET_MANUEL = 'REJET_MANUEL';

/**
 * Libellés des codes de rejet / de mise en revue (nomenclature v3 §4 / v8,
 * plage E001–E010 ; seuls E001, E006, E010 sont émis par l'adjudicateur actuel).
 */
export const LIBELLE_CODE_REJET: Record<string, string> = {
  E001: 'Police non active à la date des soins (suspendue, résiliée ou hors période)',
  E006: 'Plafond annuel de la garantie atteint ou dépassé pour cet adhérent',
  E010: "Montant remboursé au-dessus du seuil d'adjudication automatique",
  ADJ_ECHEC:
    "Échec temporaire de l'appel au microservice d'adjudication — réclamation à re-soumettre",
  REJET_MANUEL: 'Rejet prononcé après revue manuelle',
};

/** Correspondance catégorie d'acte → type de réclamation (défaut : AUTRE). */
export const CATEGORIE_VERS_TYPE: Record<string, TypeReclamation> = {
  CONSULTATION: 'SOIN',
  SOINS_INFIRMIERS: 'SOIN',
  HOSPITALISATION: 'HOSPITALISATION',
  PHARMACIE: 'PHARMACIE',
  MEDICAMENT: 'PHARMACIE',
  OPTIQUE: 'OPTIQUE',
  DENTAIRE: 'DENTAIRE',
  ANALYSES: 'ANALYSES',
  ANALYSES_LABORATOIRE: 'ANALYSES',
  IMAGERIE: 'IMAGERIE',
};

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  roleChain: string[];
}
