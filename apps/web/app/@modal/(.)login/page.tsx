import { headers } from 'next/headers';

import { ConnexionModale } from '@/components/connexion-modale';
import { RechargementComplet } from '@/components/rechargement-complet';

/**
 * Interception de `/login` lors d'une navigation client. Placée à la racine,
 * elle s'applique depuis n'importe quelle page : la superposition n'est donc
 * retenue que depuis la page d'accueil et sans `?next=`. Tout autre chemin
 * (déconnexion, redirection du proxy vers `/login?next=…`, liens des pages
 * d'authentification) recharge la page complète, comme avant.
 *
 * Accès direct, favori, actualisation : pas d'interception, `app/login/page.tsx`.
 */
export default async function ConnexionInterceptee({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const origine = (await headers()).get('next-url') ?? '';
  const depuisAccueil = origine.split(/[?#]/)[0] === '/';
  const { next } = await searchParams;

  if (!depuisAccueil || next !== undefined) {
    return <RechargementComplet />;
  }
  return <ConnexionModale />;
}
