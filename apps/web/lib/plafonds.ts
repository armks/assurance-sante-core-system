/**
 * Plafonds annuels par personne et par famille (prisma/sql/069, ADR-006) : libellés et
 * textes d'aide partagés entre le formulaire produit et les écrans de suivi.
 */

export type PeriodeCumulPlafond = 'ANNEE_POLICE' | 'ANNEE_CIVILE';

export const LIBELLE_PERIODE_CUMUL: Record<PeriodeCumulPlafond, string> = {
  ANNEE_POLICE: 'Année de police (date anniversaire du contrat)',
  ANNEE_CIVILE: 'Année civile (1er janvier – 31 décembre)',
};

export const OPTIONS_PERIODE_CUMUL = (
  Object.keys(LIBELLE_PERIODE_CUMUL) as PeriodeCumulPlafond[]
).map((valeur) => ({ valeur, libelle: LIBELLE_PERIODE_CUMUL[valeur] }));

export const AIDE_PERIODE_CUMUL =
  'Période sur laquelle les plafonds annuels se cumulent puis repartent à zéro. Année de police : à chaque date anniversaire du début du contrat.';

export const AIDE_PLAFOND_PERSONNE =
  'Montant maximal pris en charge dans l’année pour CHAQUE personne assurée (le titulaire, et chacun de ses bénéficiaires séparément). Laisser vide : pas de limite par personne.';

export const AIDE_PLAFOND_FAMILLE =
  'Montant maximal pris en charge dans l’année pour TOUTE la famille réunie (titulaire et tous ses bénéficiaires). Si les deux plafonds sont renseignés, le premier atteint s’applique. Laisser vide : pas de limite familiale.';

/** `JJ/MM/AAAA` d'une date `YYYY-MM-DD` (sans décalage de fuseau). */
export function dateCourte(iso: string): string {
  const [a, m, j] = iso.slice(0, 10).split('-');
  return `${j}/${m}/${a}`;
}
