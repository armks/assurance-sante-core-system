/**
 * Libellés des statuts du réseau de soins — SOURCE UNIQUE (fiches, panneau du
 * réseau, dashboard du centre médical). MIROIR du schéma
 * (`etablissements_sante.statut`, `pharmacies.statut`, `verification_statut`).
 */
export const LIBELLE_STATUT_ETABLISSEMENT: Record<string, string> = {
  ACTIF: 'Actif',
  SUSPENDU: 'Suspendu',
  EN_ATTENTE_VALIDATION: 'En attente de validation',
  RESILIE: 'Résilié',
};

export const LIBELLE_STATUT_PHARMACIE: Record<string, string> = {
  ACTIVE: 'Active',
  SUSPENDUE: 'Suspendue',
  RESILIEE: 'Résiliée',
};

/** Statut d'un lieu du réseau, établissement ou pharmacie. */
export const LIBELLE_STATUT_LIEU: Record<string, string> = {
  ...LIBELLE_STATUT_ETABLISSEMENT,
  ...LIBELLE_STATUT_PHARMACIE,
};

/** Types d'établissement — MIROIR de `TYPES_ETABLISSEMENT`
 * (`apps/api/src/provider/provider.types.ts`). Les pharmacies n'ont pas de type. */
export const LIBELLE_TYPE_ETABLISSEMENT: Record<string, string> = {
  HOPITAL_PUBLIC: 'Hôpital public',
  CLINIQUE_PRIVEE: 'Clinique privée',
  CABINET_MEDICAL: 'Cabinet médical',
  CENTRE_SANTE: 'Centre de santé',
  LABORATOIRE: 'Laboratoire',
  CENTRE_IMAGERIE: 'Centre d’imagerie',
  OPTICIEN: 'Opticien',
  DENTISTE: 'Dentiste',
  MATERNITE: 'Maternité',
};

export const TYPES_ETABLISSEMENT = Object.keys(LIBELLE_TYPE_ETABLISSEMENT);

export const libelleTypeEtablissement = (type: string | null | undefined) =>
  type ? (LIBELLE_TYPE_ETABLISSEMENT[type] ?? type) : '—';

export const LIBELLE_VERIFICATION: Record<string, string> = {
  ACTIF: 'Actif',
  FERME: 'Fermé',
  DEMENAGE: 'Déménagé',
  A_REVERIFIER: 'À revérifier',
};
