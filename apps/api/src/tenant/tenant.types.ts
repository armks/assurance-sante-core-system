export const TYPES_SOUSCRIPTEUR = [
  'ENTREPRISE',
  'COLLECTIVITE',
  'INDIVIDUEL',
] as const;
export type TypeSouscripteur = (typeof TYPES_SOUSCRIPTEUR)[number];

/**
 * Sous-rôles (ou rôle parent hérité) autorisés à créer / modifier / supprimer
 * un souscripteur et son comité de gestion.
 * Lecture : tout profil de l'entité ASSUREUR de la même organisation.
 *
 * Ces mêmes codes figurent dans les policies RLS `souscripteurs_modif` /
 * `membres_comite_modif` (défense en profondeur — cf. prisma/sql/001_*).
 */
export const ROLES_GESTION_SOUSCRIPTEUR = [
  'ASSUREUR_DIRECTION',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_INFORMATIQUE',
] as const;

/** Contexte d'autorisation dérivé du profil de l'appelant (via IdentityService). */
export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  entite: string | null;
  /** Chaîne de rôles résolue (rôle propre + parents), cf. IdentityService. */
  roleChain: string[];
}
