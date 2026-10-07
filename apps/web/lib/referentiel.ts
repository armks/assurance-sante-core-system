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

/**
 * Catégories d'acte — SOURCE UNIQUE des libellés, pour `categorieActe`
 * (garanties d'un produit, actes d'un dossier) et la `categorie` des
 * référentiels d'actes (organisation et catalogue national, texte libre).
 * Couvre les deux vocabulaires du schéma : celui des actes (`CATEGORIES_ACTE`,
 * miroir de l'API) et celui des garanties (`CATEGORIES_GARANTIE`), plus
 * `ANALYSES` du catalogue national.
 */
export const LIBELLE_CATEGORIE_ACTE: Record<string, string> = {
  CONSULTATION: 'Consultation',
  HOSPITALISATION: 'Hospitalisation',
  PHARMACIE: 'Pharmacie',
  OPTIQUE: 'Optique',
  DENTAIRE: 'Dentaire',
  IMAGERIE: 'Imagerie',
  BIOLOGIE: 'Biologie',
  ACTE_TECHNIQUE: 'Acte technique',
  TRANSPORT: 'Transport',
  ANALYSES: 'Analyses',
  ANALYSES_LABORATOIRE: 'Analyses de laboratoire',
  MATERNITE: 'Maternité',
  SOINS_INFIRMIERS: 'Soins infirmiers',
  TRANSPORT_SANITAIRE: 'Transport sanitaire',
  AUTRE: 'Autre',
};

/** Catégories proposées pour une garantie de produit (vocabulaire historique
 * du formulaire produit, distinct de `CATEGORIES_ACTE`). */
export const CATEGORIES_GARANTIE = [
  'CONSULTATION',
  'HOSPITALISATION',
  'PHARMACIE',
  'ANALYSES_LABORATOIRE',
  'IMAGERIE',
  'OPTIQUE',
  'DENTAIRE',
  'MATERNITE',
  'SOINS_INFIRMIERS',
  'TRANSPORT_SANITAIRE',
  'AUTRE',
];

/**
 * Libellé lisible d'une catégorie d'acte. Repli pour une valeur inconnue :
 * un code (`SOINS_PALLIATIFS`) devient « Soins palliatifs » ; un texte libre
 * déjà lisible (« Consultation », saisi dans un référentiel) est rendu tel quel.
 * Jamais le code brut en minuscules.
 */
export function libelleCategorieActe(categorie: string | null | undefined): string {
  const v = categorie?.trim();
  if (!v) return '—';
  const connu = LIBELLE_CATEGORIE_ACTE[v.toUpperCase()];
  if (connu) return connu;
  if (/^[A-Z0-9_]+$/.test(v)) {
    const t = v.replace(/_+/g, ' ').trim().toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return v;
}

/** Options de `<select>` pour une liste de codes de catégorie. */
export const optionsCategorieActe = (codes: readonly string[]) =>
  codes.map((c) => ({ valeur: c, libelle: libelleCategorieActe(c) }));
