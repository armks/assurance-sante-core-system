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
 * `ASSUREUR_COMPTABLE` ajouté ici (prisma/sql/052) : peut créer un
 * souscripteur, mais N'A PAS accès pour autant à `tarifs_conventionnes`
 * (`ROLES_GESTION_RESEAU`, provider.types.ts) ni à la création/modification
 * de `grilles_tarifaires` négociées (`ROLES_GESTION_GRILLES_TARIFAIRES`,
 * billing.types.ts) — deux périmètres distincts, restés exclusifs à
 * ASSUREUR_INFORMATIQUE.
 *
 * Ces mêmes codes figurent dans la policy RLS `souscripteurs_modif`
 * (défense en profondeur — cf. prisma/sql/001_*, étendue par prisma/sql/052) ;
 * `membres_comite_modif` reste inchangée (non demandé).
 */
export const ROLES_GESTION_SOUSCRIPTEUR = [
  'ASSUREUR_DIRECTION',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_INFORMATIQUE',
  'ASSUREUR_COMPTABLE',
] as const;

/** Contexte d'autorisation dérivé du profil de l'appelant (via IdentityService). */
export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  entite: string | null;
  /** Chaîne de rôles résolue (rôle propre + parents), cf. IdentityService. */
  roleChain: string[];
}
