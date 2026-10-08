/** Un sous-rôle que l'utilisateur connecté a le droit de créer ou de proposer. */
export interface RoleProposable {
  /** code sous_roles */
  code: string;
  libelle: string;
  /** entite_code du sous-rôle (ASSUREUR, PHARMACIE, ...) */
  entite: string;
  /**
   * CREATION_DIRECTE : le compte est créé immédiatement (invitation envoyée).
   * PROPOSITION     : le compte doit être validé par `roleValidateur`.
   */
  mode: 'CREATION_DIRECTE' | 'PROPOSITION';
  /** organisation_id | pharmacie_id | etablissement_id | null (aucun scope) */
  scopeVerifie: string | null;
  /** code du sous-rôle validateur (uniquement si mode = PROPOSITION) */
  roleValidateur: string | null;
}

/** Un compte de l'organisation — page /dashboard-assureur/informatique/utilisateurs. */
export interface CompteOrganisation {
  id: string;
  role: string | null;
  libelleRole: string | null;
  email: string | null;
  createdAt: Date;
  /** Compte désactivé par un archivage (rétabli à la main) ; null = actif. */
  desactiveLe: Date | null;
  desactiveMotif: string | null;
  /** ACTIF | REVOQUE (révocation manuelle, jamais de suppression). */
  statut: string;
  revoqueLe: Date | null;
  revoqueMotif: string | null;
  /** Entité du rôle (ASSUREUR, CENTRE_MEDICAL, PHARMACIE, SOCIETE…) : un changement de rôle reste dans l'entité. */
  entiteRole: string | null;
  /** Rattachement : sert à la réactivation groupée d'un périmètre désarchivé. */
  etablissementId: string | null;
  pharmacieId: string | null;
  societeId: string | null;
}
