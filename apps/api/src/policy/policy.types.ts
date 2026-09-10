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

/**
 * Libellés d'action pour chaque statut cible d'une transition `changerStatut`.
 * Sert à construire la réponse de `GET /policy/polices/:id/actions` — le
 * frontend ne redéfinit jamais la machine à états, il rend `actions[]` tel quel.
 */
export const LIBELLE_TRANSITION: Record<string, string> = {
  EN_SOUSCRIPTION: 'Passer en souscription',
  ACTIVE: 'Réactiver',
  SUSPENDUE: 'Suspendre',
  RENOUVELEE: 'Renouveler',
  RESILIEE: 'Résilier',
  NON_RENOUVELEE: 'Ne pas renouveler',
};

/** Une action proposée sur une police, calculée côté service depuis l'état courant. */
export interface ActionPolice {
  /** Identifiant stable de l'action (statut cible, ou `souscrire`). */
  cle: string;
  libelle: string;
  /** Endpoint à appeler : `statut` → POST :id/statut ; `souscrire` → POST :id/souscrire. */
  endpoint: 'statut' | 'souscrire';
  /** Statut cible pour `endpoint === 'statut'`. */
  statutCible?: StatutPolice;
  /** L'action ouvre un formulaire de dates (souscription). */
  avecDates?: boolean;
  /** Action destructrice / irréversible — à présenter avec prudence. */
  danger?: boolean;
}

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
