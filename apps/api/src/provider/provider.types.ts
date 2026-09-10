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

// --- Automatisation du réseau (v8 §9, PROMPT 15) ---------------------

export const METHODES_VERIFICATION = [
  'APPEL_TELEPHONIQUE',
  'VISITE_TERRAIN',
  'AUTO_DECLARATIF',
] as const;
export type MethodeVerification = (typeof METHODES_VERIFICATION)[number];

export const STATUTS_VERIFICATION = [
  'ACTIF',
  'FERME',
  'DEMENAGE',
  'A_REVERIFIER',
] as const;
export type StatutVerification = (typeof STATUTS_VERIFICATION)[number];

/** Une entrée non vérifiée depuis plus de ce délai est marquée `A_REVERIFIER`. */
export const MOIS_REVERIFICATION_DEFAUT = 12;

/** Rayon de recherche des doublons à la création (200 m). */
export const RAYON_DOUBLON_KM = 0.2;

/** Avertissement non bloquant renvoyé à la création (géocodage, doublon…). */
export interface Avertissement {
  type: 'GEOCODAGE_ECHOUE' | 'GEOCODAGE_AUTO' | 'DOUBLON_POSSIBLE';
  message: string;
  details?: unknown;
}
