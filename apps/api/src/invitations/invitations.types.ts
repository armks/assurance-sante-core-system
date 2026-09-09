/** Statuts d'une invitation (miroir de la contrainte CHECK, prisma/sql/008). */
export const STATUTS_INVITATION = [
  'EN_ATTENTE_VALIDATION_INFORMATIQUE',
  'EN_ATTENTE',
  'ACCEPTEE',
  'REJETEE',
  'EXPIREE',
  'REVOQUEE',
] as const;
export type StatutInvitation = (typeof STATUTS_INVITATION)[number];

/** Entité métier « superadmin » — pas de scope organisation. */
export const ENTITE_SUPERADMIN = 'SUPERADMIN';

/** Contexte de l'appelant authentifié, résolu depuis IdentityService. */
export interface ContexteAppelant {
  userId: string;
  role: string | null;
  entite: string | null;
  organisationId: string | null;
  pharmacieId: string | null;
  /** rôle propre + parents (héritage adjoint, v6 §3). */
  roleChain: string[];
}

/** Périmètre multi-tenant appliqué au compte qui sera créé. */
export interface ScopeInvitation {
  organisationId: string | null;
  societeId: string | null;
  etablissementId: string | null;
  pharmacieId: string | null;
  adherentId: string | null;
}
