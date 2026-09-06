/**
 * Contexte d'authentification injecté dans la requête par SupabaseAuthGuard.
 *
 * Ne contient QUE ce qui provient du JWT vérifié (Supabase Auth). Le rôle métier
 * et les permissions ne sont PAS de confiance ici : ils sont chargés depuis la
 * table `profils` par IdentityService (source de vérité applicative).
 */
export interface AuthenticatedUser {
  /** `sub` du JWT = auth.users.id Supabase = profils.id */
  sub: string;
  email: string | null;
  /** Rôle Postgres du token Supabase (typiquement "authenticated"), pas le rôle métier. */
  postgresRole: string | null;
  /** Rôle métier éventuellement propagé via un Auth Hook Supabase (claim custom). Non garanti. */
  claimRole: string | null;
  aud: string | string[] | null;
  /** Token brut, utile pour propager l'auth vers d'autres services si besoin. */
  token: string;
}
