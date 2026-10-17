import type { CategorieActe } from '@/components/categories-acte';
import { apiFetch } from '@/lib/api';

/** Référentiel quasi statique : gardé en mémoire du serveur quelques minutes plutôt que relu à chaque navigation. */
const DUREE_CACHE_MS = 5 * 60_000;
let memoire: { valeur: CategorieActe[]; expire: number } | null = null;

/**
 * Charge le référentiel unique des catégories d'acte (server-only, via
 * `apiFetch`). Appelé par les layouts des dashboards ; en cas d'erreur, liste
 * vide (non mise en cache) : les écrans retombent sur un libellé lisible dérivé du code.
 */
export async function chargerCategoriesActe(): Promise<CategorieActe[]> {
  if (memoire && memoire.expire > Date.now()) return memoire.valeur;
  try {
    const res = await apiFetch('/api/v1/reference/categories-acte');
    if (!res.ok) return [];
    const valeur = (await res.json()) as CategorieActe[];
    memoire = { valeur, expire: Date.now() + DUREE_CACHE_MS };
    return valeur;
  } catch {
    return [];
  }
}
