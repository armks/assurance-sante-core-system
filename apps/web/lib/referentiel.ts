/**
 * Statut d'homologation d'un acte ou d'un médicament (référentiel de
 * l'organisation et catalogue national) — SOURCE UNIQUE des libellés.
 * MIROIR du schéma (`PROPOSE | HOMOLOGUE | SUSPENDU | RETIRE`).
 */
export const LIBELLE_STATUT_HOMOLOGATION: Record<string, string> = {
  PROPOSE: 'Proposé',
  HOMOLOGUE: 'Homologué',
  SUSPENDU: 'Suspendu',
  RETIRE: 'Retiré',
};
