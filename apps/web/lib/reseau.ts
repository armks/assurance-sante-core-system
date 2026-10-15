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

/**
 * Catégories d'établissement HIÉRARCHISÉES, du niveau le plus bas au plus haut — MIROIR de la table `categories_etablissement`
 * (prisma/sql/100). Une formule dont le niveau d'accès est X couvre la catégorie X et toutes les catégories inférieures,
 * jamais les supérieures (un centre médical ne conduit pas à une polyclinique).
 */
export const CATEGORIES_ETABLISSEMENT = [
  { code: 'CENTRE_MEDICAL', libelle: 'Centre médical', niveau: 1 },
  { code: 'HOPITAL_PUBLIC', libelle: 'Hôpital public', niveau: 2 },
  { code: 'CLINIQUE', libelle: 'Clinique', niveau: 3 },
  { code: 'POLYCLINIQUE', libelle: 'Polyclinique', niveau: 4 },
] as const;

export const OPTIONS_CATEGORIE_ETABLISSEMENT = CATEGORIES_ETABLISSEMENT.map((c) => ({ valeur: c.code, libelle: c.libelle }));

export const libelleCategorieEtablissement = (code: string | null | undefined) =>
  CATEGORIES_ETABLISSEMENT.find((c) => c.code === code)?.libelle ?? code ?? '—';

export const niveauCategorieEtablissement = (code: string | null | undefined) =>
  CATEGORIES_ETABLISSEMENT.find((c) => c.code === code)?.niveau ?? 0;

export const libelleTypeEtablissement = (type: string | null | undefined) =>
  type ? (LIBELLE_TYPE_ETABLISSEMENT[type] ?? type) : '—';

export const LIBELLE_VERIFICATION: Record<string, string> = {
  ACTIF: 'Actif',
  FERME: 'Fermé',
  DEMENAGE: 'Déménagé',
  A_REVERIFIER: 'À revérifier',
};
