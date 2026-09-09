export const TYPES_ETABLISSEMENT = [
  'HOPITAL_PUBLIC',
  'CLINIQUE_PRIVEE',
  'CABINET_MEDICAL',
  'CENTRE_SANTE',
  'LABORATOIRE',
  'CENTRE_IMAGERIE',
  'OPTICIEN',
  'DENTISTE',
  'MATERNITE',
] as const;
export type TypeEtablissement = (typeof TYPES_ETABLISSEMENT)[number];

export const STATUTS_ETABLISSEMENT = [
  'ACTIF',
  'SUSPENDU',
  'EN_ATTENTE_VALIDATION',
  'RESILIE',
] as const;
export type StatutEtablissement = (typeof STATUTS_ETABLISSEMENT)[number];

export const STATUTS_PHARMACIE = ['ACTIVE', 'SUSPENDUE', 'RESILIEE'] as const;
export type StatutPharmacie = (typeof STATUTS_PHARMACIE)[number];

/**
 * Sous-rôles (ou parent hérité) autorisés à gérer le réseau de soins. v9 §2.2 :
 * l'Informatique gère aussi le réseau de prestataires — cohérent avec la policy
 * RLS `*_ecriture` (`profil_a_role`, prisma/sql/009) et regles_provisioning.
 */
export const ROLES_GESTION_RESEAU = ['ASSUREUR_INFORMATIQUE'] as const;

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  roleChain: string[];
}

/** Cible de la recherche géolocalisée. */
export const CIBLES_RECHERCHE = ['ETABLISSEMENTS', 'PHARMACIES', 'TOUS'] as const;
export type CibleRecherche = (typeof CIBLES_RECHERCHE)[number];
