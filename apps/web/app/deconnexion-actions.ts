'use server';

import { apiFetch } from '@/lib/api';
import { estCheminSociete } from '@/lib/slugs';

/**
 * Page où atterrir après la déconnexion, calculée AVANT le `signOut` (la session
 * est encore valide) : la page d'accueil de l'organisation de l'utilisateur
 * (`/{slug}`) — y compris pour le personnel d'un établissement ou d'une
 * pharmacie, rattaché à son assureur — si l'API la renvoie (organisation ACTIVE) ;
 * sinon `/` : superadmin sans organisation, organisation suspendue, compte sans
 * profil, API injoignable.
 */
export async function destinationApresDeconnexion(): Promise<string> {
  try {
    const res = await apiFetch('/api/v1/identity/me');
    if (!res.ok) return '/';
    const me = (await res.json()) as { profil?: { organisationSlug?: string | null } };
    const slug = me.profil?.organisationSlug;
    return slug && estCheminSociete(`/${slug}`) ? `/${slug}` : '/';
  } catch {
    return '/';
  }
}
