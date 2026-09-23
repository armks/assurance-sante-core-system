export const PERIODICITES = [
  'MENSUELLE',
  'TRIMESTRIELLE',
  'SAISONNIERE',
  'ANNUELLE',
] as const;

export const STATUTS_COTISATION = [
  'A_PAYER',
  'PAYEE',
  'EN_RETARD',
  'ANNULEE',
] as const;

/** Rôles ASSUREUR habilités à gérer les cotisations (génération, paiement,
 * pénalités) — via profil_a_role. NE couvre PAS la gestion des grilles
 * tarifaires négociées, périmètre distinct et plus restreint (voir
 * `ROLES_GESTION_GRILLES_TARIFAIRES` ci-dessous) : ASSUREUR_COMPTABLE peut
 * générer des cotisations mais ne doit jamais pouvoir créer/modifier une
 * grille tarifaire. */
export const ROLES_GESTION_BILLING = [
  'ASSUREUR_COMPTABLE',
  'ASSUREUR_INFORMATIQUE',
] as const;

/**
 * Grilles tarifaires (standard ET négociées) — réservé EXCLUSIVEMENT à
 * ASSUREUR_INFORMATIQUE, même périmètre que `tarifs_conventionnes`
 * (`ROLES_GESTION_RESEAU`, provider.types.ts). ASSUREUR_COMPTABLE en est
 * délibérément exclu (prisma/sql/052) — il gère les cotisations issues de
 * ces grilles, jamais les grilles elles-mêmes.
 */
export const ROLES_GESTION_GRILLES_TARIFAIRES = ['ASSUREUR_INFORMATIQUE'] as const;

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  entite: string | null;
  societeId: string | null;
  roleChain: string[];
}

/** Résultat du calcul de cotisation (montants en chaîne, 2 décimales). */
export interface CalculCotisation {
  montantDu: string;
  tarifBase: string;
  /** NEGOCIE = grille propre au souscripteur ; STANDARD = grille produit. */
  source: 'NEGOCIE' | 'STANDARD';
  /** part du membre après subvention éventuelle (100 si pas de subvention). */
  partMembrePourcent: number;
  grilleTarifaireId: string;
}
