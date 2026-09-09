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

/** Rôles ASSUREUR habilités à gérer la facturation (via profil_a_role). */
export const ROLES_GESTION_BILLING = [
  'ASSUREUR_COMPTABLE',
  'ASSUREUR_INFORMATIQUE',
] as const;

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
