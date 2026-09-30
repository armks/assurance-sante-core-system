import { headers } from 'next/headers';

import { apiFetchPublic } from '@/lib/api';

/** Miroir de `EvenementPublic` (API, module vitrine). */
export interface EvenementPublic {
  id: string;
  titre: string;
  description: string | null;
  imageUrl: string;
  dateEvenement: string;
  statut: 'A_VENIR' | 'PASSE';
}

/**
 * Événements publiés (GET /api/v1/public/evenements, 5 au plus), lus côté
 * serveur au rendu de la page d'accueil — ceux de l'organisation vitrine, ou
 * ceux de la société `slugOrganisation` sur sa page /{slug}. IP du visiteur
 * transmise pour le limiteur. Toute erreur (API injoignable, 429) renvoie une
 * liste vide : le bloc « Qui sommes-nous » garde alors son image habituelle.
 */
export async function chargerEvenementsPublics(slugOrganisation?: string): Promise<EvenementPublic[]> {
  try {
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '';
    const chemin = slugOrganisation
      ? `/api/v1/public/evenements?organisation=${encodeURIComponent(slugOrganisation)}`
      : '/api/v1/public/evenements';
    const res = await apiFetchPublic(chemin, {
      headers: ip ? { 'X-Forwarded-For': ip } : {},
    });
    return res.ok ? ((await res.json()) as EvenementPublic[]) : [];
  } catch {
    return [];
  }
}
