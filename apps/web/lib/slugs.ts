/**
 * Pages d'accueil des sociétés : https://<domaine>/<slug>.
 *
 * Segments réservés : premiers segments d'URL que l'application utilise déjà.
 *
 * ⚠ AJOUT D'UNE PAGE DE PREMIER NIVEAU (ex. /tarifs) — trois endroits à
 * mettre à jour ENSEMBLE, sinon une société pourrait prendre ce chemin (ou le
 * proxy traiterait la page comme publique) :
 *   1. API       : apps/api/src/common/slug.util.ts  → SEGMENTS_RESERVES
 *   2. Proxy web : apps/web/lib/slugs.ts             → SEGMENTS_RESERVES
 *   3. Base      : contrainte organisations_slug_non_reserve (prisma/sql/061) —
 *                  nouvelle migration : drop constraint + add constraint avec la
 *                  liste complétée (vérifier avant qu'aucun slug existant ne la viole).
 * Les segments commençant par `dashboard` sont déjà réservés aux trois endroits.
 */
const SEGMENTS_RESERVES = new Set([
  'accepter-invitation',
  'admin',
  'api',
  'auth',
  'favicon',
  'images',
  'login',
  'logout',
  'protected',
  'public',
  'reseau-de-soins',
  'robots',
  'sitemap',
  'static',
  'superadmin',
]);

const FORMAT_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** `true` si `pathname` a la forme d'une page de société (`/{slug}`, un seul segment). */
export function estCheminSociete(pathname: string): boolean {
  const segment = pathname.slice(1);
  return (
    pathname.startsWith('/') &&
    segment.length >= 2 &&
    segment.length <= 60 &&
    FORMAT_SLUG.test(segment) &&
    !segment.startsWith('dashboard') &&
    !SEGMENTS_RESERVES.has(segment)
  );
}
