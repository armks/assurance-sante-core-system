import { cache } from 'react';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export interface IdentityMe {
  profil: {
    id: string;
    organisationId: string | null;
    /** Page d'accueil de l'organisation (/{slug}) si elle est active, sinon null. */
    organisationSlug: string | null;
    role: string | null;
    libelleRole: string | null;
    entite: string | null;
    email: string | null;
  };
  permissions: {
    roleChain: string[];
    niveauAcces: 'LECTURE_SEULE' | 'MODIFICATION' | 'ADMIN';
    peutValider: boolean;
    dashboardRoute: string | null;
    estRoleMedical: boolean;
    scope: Record<string, string | null>;
  } | null;
}

/** Identité d'un compte provisionné : `permissions` est garanti non-null. */
export type IdentityMeProvisionne = IdentityMe & {
  permissions: NonNullable<IdentityMe['permissions']>;
};

export type EtatIdentite =
  | { kind: 'anonyme' }
  | { kind: 'ok'; email: string; identity: IdentityMeProvisionne }
  | { kind: 'non-provisionne'; email: string }
  | { kind: 'erreur'; email: string; status: number; message: string };

/**
 * Charge l'identité une seule fois par requête (React `cache`). Ne redirige pas
 * ici — voir `exigerIdentite`.
 */
const chargerIdentiteBrut = cache(async (): Promise<EtatIdentite> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: 'anonyme' };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { kind: 'anonyme' };

  const email = user.email ?? '—';

  try {
    const res = await fetch(`${API_URL}/api/v1/identity/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
    });

    if (res.status === 404) return { kind: 'non-provisionne', email };
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return {
        kind: 'erreur',
        email,
        status: res.status,
        message: body.message ?? res.statusText,
      };
    }

    const identity = (await res.json()) as IdentityMe;
    if (!identity.permissions) return { kind: 'non-provisionne', email };
    return {
      kind: 'ok',
      email,
      identity: identity as IdentityMeProvisionne,
    };
  } catch {
    return {
      kind: 'erreur',
      email,
      status: 0,
      message: `Impossible de joindre l’API (${API_URL}).`,
    };
  }
});

/**
 * Comme `chargerIdentiteBrut`, mais redirige vers /login si pas de session.
 * Le résultat renvoyé est donc l'un de : ok | non-provisionne | erreur.
 */
export async function exigerIdentite(
  cible: string,
): Promise<Exclude<EtatIdentite, { kind: 'anonyme' }>> {
  const etat = await chargerIdentiteBrut();
  if (etat.kind === 'anonyme') {
    redirect(`/login?next=${encodeURIComponent(cible)}`);
  }
  return etat;
}

/** Y a-t-il une session Supabase valide ? (pour la page d'accueil publique) */
export async function aUneSession(): Promise<boolean> {
  const etat = await chargerIdentiteBrut();
  return etat.kind !== 'anonyme';
}
