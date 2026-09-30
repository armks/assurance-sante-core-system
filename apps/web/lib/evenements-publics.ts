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
 * serveur au rendu de la page d'accueil, IP du visiteur transmise pour le
 * limiteur. Toute erreur (API injoignable, 429) renvoie une liste vide : le
 * bloc « Qui sommes-nous » garde alors son image habituelle.
 */
export async function chargerEvenementsPublics(): Promise<EvenementPublic[]> {
  try {
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '';
    const res = await apiFetchPublic('/api/v1/public/evenements', {
      headers: ip ? { 'X-Forwarded-For': ip } : {},
    });
    return res.ok ? ((await res.json()) as EvenementPublic[]) : [];
  } catch {
    return [];
  }
}
