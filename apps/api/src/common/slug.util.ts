/**
 * Slug d'organisation : chemin de sa page d'accueil dédiée (/{slug}).
 * Minuscules, chiffres, tirets simples ; 2 à 60 caractères (prisma/sql/061).
 */
export const FORMAT_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const LONGUEUR_MAX_SLUG = 60;

/**
 * Premiers segments d'URL déjà pris par l'application ou des ressources
 * techniques.
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
export const SEGMENTS_RESERVES: ReadonlySet<string> = new Set([
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

export const estReserve = (slug: string) => slug.startsWith('dashboard') || SEGMENTS_RESERVES.has(slug);

/** « Mutuelle Générale d'Abidjan » → `mutuelle-generale-d-abidjan`. */
export function slugDepuisNom(nom: string): string {
  const s = nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LONGUEUR_MAX_SLUG)
    .replace(/-+$/g, '');
  if (s.length < 2) return 'organisation';
  return estReserve(s) ? `${s.slice(0, LONGUEUR_MAX_SLUG - 13)}-organisation` : s;
}

/** Message d'erreur si le slug proposé est invalide, `null` sinon. */
export function erreurSlug(slug: string): string | null {
  if (slug.length < 2 || slug.length > LONGUEUR_MAX_SLUG) {
    return `Le chemin doit faire entre 2 et ${LONGUEUR_MAX_SLUG} caractères.`;
  }
  if (!FORMAT_SLUG.test(slug)) {
    return 'Le chemin ne peut contenir que des minuscules sans accent, des chiffres et des tirets simples.';
  }
  if (estReserve(slug)) return `« ${slug} » est réservé par l’application.`;
  return null;
}

/**
 * Premier slug libre : `base`, puis `base-2`, `base-3`… (`existe` interroge la
 * base, en excluant éventuellement l'organisation elle-même).
 */
export async function slugLibre(base: string, existe: (slug: string) => Promise<boolean>): Promise<string> {
  if (!(await existe(base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidat = `${base.slice(0, LONGUEUR_MAX_SLUG - String(n).length - 1)}-${n}`;
    if (!(await existe(candidat))) return candidat;
  }
  throw new Error(`Aucun slug libre à partir de « ${base} ».`);
}
