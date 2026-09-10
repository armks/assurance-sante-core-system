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
 * (Défense en profondeur en plus des policies RLS — NestJS passe par `postgres`.)
 */
export const ROLES_GESTION_CLAIMS = [
  'ASSUREUR_DIRECTION',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_INFORMATIQUE',
] as const;

/** Le seul statut depuis lequel `soumettre` verrouille — tout le reste est « au-delà ». */
export const STATUT_INITIAL: StatutReclamation = 'SOUMISE';
export const STATUT_VERROUILLE: StatutReclamation = 'EN_ADJUDICATION';

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
