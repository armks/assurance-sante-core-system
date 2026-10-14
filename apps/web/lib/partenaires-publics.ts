import { headers } from 'next/headers';

import { apiFetchPublic } from '@/lib/api';

/** Miroir de `PartenairePublic` (API, module vitrine). */
export interface PartenairePublic {
  id: string;
  nom: string;
  logoUrl: string;
  siteUrl: string | null;
}

/**
 * Logos des partenaires du bandeau défilant (GET /api/v1/public/partenaires), lus côté serveur au rendu de la page d'accueil — ceux de
 * l'organisation vitrine, ou ceux de la société `slugOrganisation` sur sa page /{slug}. Toute erreur (API injoignable, 429) renvoie une
 * liste vide : le bandeau n'est alors pas affiché sur la page d'une société (et garde ses emplacements neutres sur la page principale).
 */
export async function chargerPartenairesPublics(slugOrganisation?: string): Promise<PartenairePublic[]> {
  try {
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '';
    const chemin = slugOrganisation
      ? `/api/v1/public/partenaires?organisation=${encodeURIComponent(slugOrganisation)}`
      : '/api/v1/public/partenaires';
    const res = await apiFetchPublic(chemin, { headers: ip ? { 'X-Forwarded-For': ip } : {} });
    return res.ok ? ((await res.json()) as PartenairePublic[]) : [];
  } catch {
    return [];
  }
}
