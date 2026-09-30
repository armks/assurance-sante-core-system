/**
 * Pages d'accueil des sociétés : https://<domaine>/<slug>.
 *
 * Segments réservés — MÊME liste que `apps/api/src/common/slug.util.ts` et
 * que la contrainte `organisations_slug_non_reserve` (prisma/sql/061). Tout
 * segment commençant par `dashboard` est aussi réservé.
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
