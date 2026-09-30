import { headers } from 'next/headers';

import { apiFetchPublic } from '@/lib/api';

export type CleStatistique = 'codesConsultation' | 'ordonnancesTraitees' | 'ticketsSoins' | 'facturesReglees';

/** Miroir de `StatistiquesPubliques` (API, module vitrine). `null` = sous le seuil. */
export interface StatistiquesPubliques {
  arreteAu: string;
  seuilMinimum: number;
  compteurs: Record<CleStatistique, number | null>;
}

/**
 * Statistiques publiques (GET /api/v1/public/statistiques), lues côté serveur
 * au rendu de la page d'accueil. L'IP du visiteur est transmise pour le
 * limiteur de débit de l'API. Toute erreur (API injoignable, 429) renvoie
 * `null` : la page s'affiche simplement sans chiffres.
 */
export async function chargerStatistiquesPubliques(): Promise<StatistiquesPubliques | null> {
  try {
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '';
    const res = await apiFetchPublic('/api/v1/public/statistiques', {
      headers: ip ? { 'X-Forwarded-For': ip } : {},
    });
    return res.ok ? ((await res.json()) as StatistiquesPubliques) : null;
  } catch {
    return null;
  }
}
