/**
 * Modèle neutre d'un rapport imprimable : chaque rapport (activité, facturation, cotisations…) produit un
 * `RapportDocument`, et les générateurs PDF et Word le mettent en page sans rien connaître du métier.
 */
export interface IndicateurRapport {
  libelle: string;
  valeur: string;
}

export interface ColonneRapport {
  titre: string;
  /** alignement du contenu (nombres et montants à droite) */
  align?: 'gauche' | 'droite' | 'centre';
  /** poids relatif de la largeur (1 par défaut) */
  poids?: number;
}

export interface TableauRapport {
  colonnes: ColonneRapport[];
  lignes: string[][];
  /** ligne de total, mise en gras */
  total?: string[];
  note?: string;
}

export interface SectionRapport {
  titre: string;
  indicateurs?: IndicateurRapport[];
  tableau?: TableauRapport;
}

export interface RapportDocument {
  titre: string;
  sousTitre?: string;
  organisation: string;
  /** critères appliqués, affichés en tête (« Période : 01/04/2026 au 30/04/2026 ») */
  filtres: { libelle: string; valeur: string }[];
  genereLe: string;
  genererPar?: string;
  sections: SectionRapport[];
}

export const entier = (n: number | string | null | undefined): string =>
  Math.round(Number(n ?? 0))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
/** Montant en francs CFA avec espaces ordinaires (les espaces insécables fines de `toLocaleString` ne s'impriment pas en PDF). */
export const francs = (n: number | string | null | undefined): string => `${entier(n)} F`;
export const pourcent = (n: number): string => `${(Math.round(n * 10) / 10).toString().replace('.', ',')} %`;
export const dateFr = (d: Date | string | null | undefined): string => {
  if (!d) return '—';
  const x = new Date(d);
  return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`;
};
