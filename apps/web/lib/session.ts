import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';

/**
 * Session Supabase lue UNE seule fois par requête (React `cache`) : sans cela, chaque `apiFetch` d'une page
 * recréait un client et relisait les cookies. Le jeton est de toute façon revérifié par l'API (JWKS).
 */
export const lireSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
});

/**
 * Courriel du compte connecté, tiré des claims du JWT vérifiés localement (clés publiques JWKS, mises en cache) :
 * évite l'aller-retour réseau vers Supabase Auth de `getUser()` à chaque page.
 */
export const lireEmailVerifie = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;
  return typeof claims.email === 'string' ? claims.email : '—';
});
