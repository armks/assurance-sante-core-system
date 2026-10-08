import type { Prisma, PrismaClient } from '@prisma/client';

/** Actions contrôlées par le service des dépendances (ADR-007). */
export const ACTIONS = ['supprimer', 'archiver', 'desarchiver', 'modifier'] as const;
export type Action = (typeof ACTIONS)[number];

/** Base lue par le registre : client Prisma ou transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** Périmètre du jeton de l'appelant : tout comptage y est restreint. */
export interface ContexteDependances {
  userId: string;
  /** null pour le superadministrateur (catalogue national, organisations). */
  organisationId: string | null;
  roleChain: string[];
  /** `profils.societe_id` — périmètre des rôles SOCIETE_*. */
  societeId: string | null;
  /** Vrai si l'appelant n'agit QUE via un rôle société (périmètre = sa société). */
  estSociete: boolean;
}

/** Un type de lien (clé étrangère OU lien logique), compté par UNE requête. */
export interface DefinitionDependance<R = any> {
  /** Clé stable (tests, réponse API). */
  cle: string;
  singulier: string;
  pluriel: string;
  /** Actions que ce lien empêche (défaut : supprimer). */
  bloque?: readonly Action[];
  /** Exactement UN appel `count` — restreint au périmètre `ctx`. */
  compter(db: Db, rec: R, ctx: ContexteDependances): Promise<number>;
}

/** Règle d'état propre à l'entité : raison (française) si l'action est impossible. */
export type RegleEtat<R = any> = (rec: R, ctx: ContexteDependances) => string | null;

export interface DefinitionEntite<R = any> {
  /** « l'établissement », « la pharmacie »… (avec article). */
  designation: string;
  /** Pronom complément pour « Archivez-le / Archivez-la ». */
  pronom: 'le' | 'la';
  /** Table cible des lignes d'audit (refus). */
  table: string;
  /** Rôles autorisés à consulter et à agir. */
  roles: readonly string[];
  /** SOCIETE_ADMINISTRATION autorisée sur SON périmètre (adhérents, bénéficiaires). */
  roleSociete?: string;
  /** Charge l'enregistrement DANS le périmètre (null → 404, sans rien révéler). */
  charger(db: Db, id: string, ctx: ContexteDependances): Promise<R | null>;
  nom(rec: R): string;
  dependances: readonly DefinitionDependance<R>[];
  /**
   * Règles d'état par action. Action absente : « pas encore disponible pour ce type
   * d'élément » (archivage d'une entité sans statut d'archive, par ex.).
   */
  regles: Partial<Record<Action, RegleEtat<R>>>;
}

export interface LienCompte {
  type: string;
  libelle: string;
  nombre: number;
}

/** Réponse de `GET /dependances/:entite/:id/:action`. */
export interface Verdict {
  entite: string;
  id: string;
  nom: string;
  action: Action;
  possible: boolean;
  /** Raison en français, avec les nombres ; null si l'action est possible. */
  raison: string | null;
  /** Tous les liens non nuls (informatif), quelle que soit l'action. */
  liens: LienCompte[];
}
