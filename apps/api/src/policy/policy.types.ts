export const STATUTS_POLICE = [
  'DEVIS',
  'EN_SOUSCRIPTION',
  'ACTIVE',
  'SUSPENDUE',
  'RENOUVELEE',
  'RESILIEE',
  'NON_RENOUVELEE',
] as const;
export type StatutPolice = (typeof STATUTS_POLICE)[number];

/**
 * Machine à états STRICTE (v3 §3). Toute transition absente de cette table est
 * refusée explicitement — pas de saut d'étape (ex. DEVIS → ACTIVE interdit).
 */
export const TRANSITIONS_POLICE: Record<StatutPolice, StatutPolice[]> = {
  DEVIS: ['EN_SOUSCRIPTION'],
  EN_SOUSCRIPTION: ['ACTIVE'],
  ACTIVE: ['SUSPENDUE', 'RENOUVELEE', 'RESILIEE', 'NON_RENOUVELEE'],
  SUSPENDUE: ['ACTIVE'], // réactivation
  RENOUVELEE: [],
  RESILIEE: [],
  NON_RENOUVELEE: [],
};

export const TYPES_AVENANT = [
  'AJOUT_ADHERENT',
  'RADIATION_ADHERENT',
  'CHANGEMENT_FORMULE',
  'AJOUT_BENEFICIAIRE',
  'MODIFICATION_TARIFAIRE',
  'RESILIATION',
] as const;
export type TypeAvenant = (typeof TYPES_AVENANT)[number];

export const STATUTS_AVENANT = ['BROUILLON', 'APPLIQUE', 'ANNULE'] as const;

/** Rôles ASSUREUR habilités à gérer les polices et avenants (via profil_a_role). */
export const ROLES_GESTION_POLICE = [
  'ASSUREUR_DIRECTION',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_INFORMATIQUE',
] as const;

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  /** Entité du profil : 'ASSUREUR' voit toutes les polices de l'org. */
  entite: string | null;
  /** souscripteur rattaché au profil (SOCIETE_ADMINISTRATION), pour la lecture scopée. */
  societeId: string | null;
  roleChain: string[];
}
