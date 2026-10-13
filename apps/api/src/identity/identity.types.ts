/** Niveaux d'accès des sous-rôles, du plus faible au plus fort. */
export const NIVEAUX_ACCES = ['LECTURE_SEULE', 'MODIFICATION', 'ADMIN'] as const;
export type NiveauAcces = (typeof NIVEAUX_ACCES)[number];

/** Codes de sous-rôles considérés comme « médicaux » (séparation v10 §2). */
export const ROLES_MEDICAUX = [
  'CENTRE_MEDICAL_MEDECIN',
  'ASSUREUR_MEDECIN_CONSEIL',
  'ASSUREUR_MEDECIN_SOUSCRIPTEUR',
] as const;

export interface ProfilResume {
  id: string;
  organisationId: string | null;
  /** Chemin de la page d'accueil de l'organisation (/{slug}) ; null si aucune organisation ou si elle n'est pas ACTIVE. */
  organisationSlug: string | null;
  /** Code sous_roles ; null si le compte n'a pas encore de rôle assigné. */
  role: string | null;
  libelleRole: string | null;
  entite: string | null;
  /** Provient du JWT Supabase vérifié (table auth.users, non modélisée côté Prisma). */
  email: string | null;
  numeroOrdreMedecin: string | null;
  methodeConnexion: string | null;
  mfaActive: boolean;
  societeId: string | null;
  etablissementId: string | null;
  pharmacieId: string | null;
  adherentId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  /** Pseudo d'affichage choisi par l'utilisateur (facultatif). */
  pseudo: string | null;
  /** Vrai si l'utilisateur a une photo (URL signée à la demande : GET /identity/me/photo). */
  aPhoto: boolean;
  /** Nom de la structure d'appartenance, pour l'affichage du profil. */
  organisationNom: string | null;
  etablissementNom: string | null;
  pharmacieNom: string | null;
  societeNom: string | null;
}

export interface PermissionsResume {
  /** Chaîne de rôles, du rôle propre vers ses parents (héritage adjoint, v6 §3). */
  roleChain: string[];
  /** Niveau d'accès effectif = le plus élevé de la chaîne. */
  niveauAcces: NiveauAcces;
  /** Vrai si un rôle de la chaîne peut valider. */
  peutValider: boolean;
  /** Route du dashboard : celle du rôle propre, sinon héritée du premier parent qui en a une. */
  dashboardRoute: string | null;
  /** Vrai si le rôle propre est un rôle médical (accès cloisonné, v10). */
  estRoleMedical: boolean;
  /** Périmètre d'action multi-tenant / réseau de soins. */
  scope: {
    organisationId: string | null;
    societeId: string | null;
    etablissementId: string | null;
    pharmacieId: string | null;
    adherentId: string | null;
  };
}

export interface IdentityMeResponse {
  profil: ProfilResume;
  /** null si le compte n'a pas encore de sous-rôle assigné. */
  permissions: PermissionsResume | null;
}
