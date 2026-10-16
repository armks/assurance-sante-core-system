import { headers } from 'next/headers';

import { apiFetchPublic } from '@/lib/api';

/** Miroir de `AnnoncePublique` (API, module vitrine). */
export interface AnnoncePublique {
  id: string;
  texte: string;
  dureeAffichageSecondes: number;
}

/**
 * Annonces du bandeau défilant (GET /api/v1/public/annonces) lues côté serveur au rendu de la page d'accueil : celles de la
 * société `slugOrganisation` sur sa page /{slug} (ou de la plateforme sur `/`), plus les diffusions à toute la plateforme.
 * Toute erreur (API injoignable, 429) renvoie une liste vide : la page s'affiche sans bandeau.
 */
export async function chargerAnnoncesPubliques(slugOrganisation?: string): Promise<AnnoncePublique[]> {
  try {
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '';
    const chemin = slugOrganisation
      ? `/api/v1/public/annonces?organisation=${encodeURIComponent(slugOrganisation)}`
      : '/api/v1/public/annonces';
    const res = await apiFetchPublic(chemin, { headers: ip ? { 'X-Forwarded-For': ip } : {} });
    return res.ok ? ((await res.json()) as AnnoncePublique[]) : [];
  } catch {
    return [];
  }
}
