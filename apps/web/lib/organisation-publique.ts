import { headers } from 'next/headers';

import { apiFetchPublic } from '@/lib/api';

/** Miroir de la fiche publique d'une société (`GET /api/v1/public/organisations/:slug`). */
export interface OrganisationPublique {
  slug: string;
  nom: string;
  logoUrl: string | null;
  /** Coordonnées affichées dans son pied de page (null : celles de la plateforme). */
  emailContact: string | null;
  telephoneContact: string | null;
  /** Bannière personnalisée (null : valeur par défaut de la plateforme). */
  heroTitre: string | null;
  heroSousTitre: string | null;
  heroImageUrl: string | null;
}

/** En-tête X-Forwarded-For du visiteur, pour les limiteurs de l'API. */
export async function enTeteIpVisiteur(): Promise<HeadersInit> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '';
  return ip ? { 'X-Forwarded-For': ip } : {};
}

/**
 * Société ACTIVE correspondant au slug, ou `null` (inconnue, inactive) → la
 * page `/[slug]` répond 404. Une erreur technique (API injoignable, 429)
 * remonte : mieux vaut une page d'erreur qu'un faux 404.
 */
export async function chargerOrganisationPublique(slug: string): Promise<OrganisationPublique | null> {
  const res = await apiFetchPublic(`/api/v1/public/organisations/${encodeURIComponent(slug)}`, {
    headers: await enTeteIpVisiteur(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Fiche de la société indisponible (${res.status}).`);
  return (await res.json()) as OrganisationPublique;
}
