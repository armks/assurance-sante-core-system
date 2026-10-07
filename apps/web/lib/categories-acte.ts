import type { CategorieActe } from '@/components/categories-acte';
import { apiFetch } from '@/lib/api';

/**
 * Charge le référentiel unique des catégories d'acte (server-only, via
 * `apiFetch`). Appelé par les layouts des dashboards ; en cas d'erreur, liste
 * vide : les écrans retombent sur un libellé lisible dérivé du code.
 */
export async function chargerCategoriesActe(): Promise<CategorieActe[]> {
  try {
    const res = await apiFetch('/api/v1/reference/categories-acte');
    return res.ok ? ((await res.json()) as CategorieActe[]) : [];
  } catch {
    return [];
  }
}
