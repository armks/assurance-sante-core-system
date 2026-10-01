/**
 * Paramètres d'une liste paginée côté serveur, lus dans l'URL de la page
 * (`searchParams`) et relayés tels quels à l'API — seules les clés connues
 * passent (l'API rejette de toute façon une valeur invalide en 400).
 */
export type ParametresUrl = Record<string, string | string[] | undefined>;

export function requeteListe(params: ParametresUrl, cles: string[]): string {
  const p = new URLSearchParams();
  for (const k of ['page', 'limite', ...cles]) {
    const v = params[k];
    const val = Array.isArray(v) ? v[0] : v;
    if (val) p.set(k, val);
  }
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

/** Page vide de repli (erreur API) — jamais un faux « aucun résultat » silencieux. */
export const PAGE_VIDE = { items: [], total: 0, page: 1, limite: 25, pages: 1 };
