export const STATUTS_PRODUIT = ['BROUILLON', 'PUBLIE', 'ARCHIVE'] as const;
export type StatutProduit = (typeof STATUTS_PRODUIT)[number];

export const RESEAUX_SOINS = ['CONVENTIONNE_SEUL', 'TOUT_RESEAU'] as const;
export type ReseauSoins = (typeof RESEAUX_SOINS)[number];

/**
 * Sous-rôles (ou rôle parent hérité) autorisés à créer / modifier / publier /
 * archiver un produit et ses garanties. Ces mêmes codes figurent dans la policy
 * RLS `produits_ecriture` / `garanties_ecriture` via `profil_a_role()` — même
 * pattern que le PROMPT 5 (défense en profondeur).
 */
export const ROLES_GESTION_PLAN = [
  'ASSUREUR_DIRECTION',
  'ASSUREUR_INFORMATIQUE',
] as const;

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  /** Chaîne de rôles résolue (rôle propre + parents), cf. IdentityService. */
  roleChain: string[];
}
