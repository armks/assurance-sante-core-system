/**
 * Formats d'affichage partagés (dates, périodes, montants, pourcentages).
 *
 * Remplace les helpers recopiés écran par écran (`dateFr`, `montant`…) avec un
 * rendu identique à l'existant : `fr-FR`, montants suivis de « F », « — » pour
 * une valeur absente. Les calculs financiers restent côté API (`decimal.js`) :
 * ces fonctions ne font que présenter une valeur déjà calculée.
 */

type ValeurDate = string | Date | null | undefined;
type ValeurNombre = string | number | null | undefined;

/** Affiché quand la valeur est absente (`null`, `undefined`, chaîne vide). */
export const VIDE = '—';

const absent = (v: unknown): v is null | undefined | '' =>
  v === null || v === undefined || v === '';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR');
const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
// Période de facturation : toujours lue en UTC (1er du mois à minuit UTC), pour
// ne jamais basculer sur le mois précédent selon le fuseau du navigateur.
const FORMAT_MOIS = new Intl.DateTimeFormat('fr-FR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const FORMAT_NOMBRE = new Intl.NumberFormat('fr-FR');

/** `2026-09-29` → `29/09/2026`. */
export function dateFr(d: ValeurDate): string {
  return absent(d) ? VIDE : FORMAT_DATE.format(new Date(d));
}

/** `2026-09-29T14:03:05Z` → `29/09/2026 14:03:05` (heure locale). */
export function dateHeureFr(d: ValeurDate): string {
  return absent(d) ? VIDE : FORMAT_DATE_HEURE.format(new Date(d));
}

/**
 * Mois d'une période : `2026-09`, `2026-09-01` ou ISO complet → `septembre 2026`.
 * Lu en UTC (voir `FORMAT_MOIS`).
 */
export function moisFr(d: ValeurDate): string {
  if (absent(d)) return VIDE;
  const date =
    typeof d === 'string' && /^\d{4}-\d{2}$/.test(d)
      ? new Date(`${d}-01T00:00:00Z`)
      : new Date(d);
  return FORMAT_MOIS.format(date);
}

/** Période courte : `2026-09…` → `09/2026` (lecture textuelle, sans fuseau). */
export function periodeFr(d: string | null | undefined): string {
  if (absent(d)) return VIDE;
  const [annee, mois] = d.slice(0, 7).split('-');
  return `${mois}/${annee}`;
}

/**
 * Montant en francs : `12500.5` → `12 500,5 F`.
 * `arrondi` : entier le plus proche (chiffres-clés des vues d'ensemble).
 */
export function montantF(
  v: ValeurNombre,
  { arrondi = false }: { arrondi?: boolean } = {},
): string {
  if (absent(v)) return VIDE;
  const n = Number(v);
  return `${FORMAT_NOMBRE.format(arrondi ? Math.round(n) : n)} F`;
}

/** Pourcentage déjà exprimé en % : `80` → `80 %`. */
export function pourcent(v: ValeurNombre): string {
  return absent(v) ? VIDE : `${Number(v)} %`;
}
