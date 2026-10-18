/** Paramétrage de l'impression des reçus de caisse (établissement sanitaire ou pharmacie). */
export interface ParametresImpression {
  typeImprimante: 'THERMIQUE_58' | 'THERMIQUE_80' | 'A4';
  enTete: string | null;
  piedPage: string | null;
  identifiantFiscal: string | null;
  afficherDetail: boolean;
}
