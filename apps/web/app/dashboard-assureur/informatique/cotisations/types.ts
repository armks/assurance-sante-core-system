/** Résultat de POST /billing/cotisations/calculer (ne persiste rien). */
export interface Calcul {
  montantDu: string;
  tarifBase: string;
  source: 'NEGOCIE' | 'STANDARD';
  partMembrePourcent: number;
  grilleTarifaireId: string;
}
