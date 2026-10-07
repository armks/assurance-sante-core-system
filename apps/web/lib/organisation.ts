/**
 * Statuts des organisations et de leurs licences (`organisations.statut`,
 * `licences.statut`) — SOURCE UNIQUE des libellés pour les écrans superadmin.
 */
export const LIBELLE_STATUT_ORGANISATION: Record<string, string> = {
  ACTIVE: 'Active',
  SUSPENDUE: 'Suspendue',
  ARCHIVEE: 'Archivée',
};

export const LIBELLE_STATUT_LICENCE: Record<string, string> = {
  ACTIVE: 'Active',
  SUSPENDUE: 'Suspendue',
  EXPIREE: 'Expirée',
};
