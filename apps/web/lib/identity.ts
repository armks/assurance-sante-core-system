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
    pseudo?: string | null;
    aPhoto?: boolean;
    organisationNom?: string | null;
    etablissementNom?: string | null;
    pharmacieNom?: string | null;
    societeNom?: string | null;
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

/** Organisation SUSPENDUE / inactive : accès coupé (403 de GET /identity/me). */
export interface EtatSuspendu {
  kind: 'organisation-suspendue';
  email: string;
  code: 'ORGANISATION_SUSPENDUE' | 'ORGANISATION_INACTIVE' | 'PERIMETRE_ARCHIVE' | 'COMPTE_DESACTIVE';
  organisation: string | null;
  message: string;
}

export const ROUTE_ACCES_SUSPENDU = '/acces-suspendu';

/**
 * Charge l'identité une seule fois par requête (React `cache`). Ne redirige pas
 * ici — voir `exigerIdentite`.
 */
const chargerIdentiteBrut = cache(async (): Promise<EtatIdentite | EtatSuspendu> => {
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
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
        organisation?: string | null;
      };
      if (
        res.status === 403 &&
        (body.code === 'ORGANISATION_SUSPENDUE' || body.code === 'ORGANISATION_INACTIVE' || body.code === 'PERIMETRE_ARCHIVE' || body.code === 'COMPTE_DESACTIVE')
      ) {
        return {
          kind: 'organisation-suspendue',
          email,
          code: body.code,
          organisation: body.organisation ?? null,
          message: body.message ?? 'L’accès de votre société est suspendu.',
        };
      }
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
  // Société suspendue : un seul écran explicite pour TOUTES les pages
  // protégées (elles passent toutes par ici), jamais une page cassée.
  if (etat.kind === 'organisation-suspendue') {
    redirect(ROUTE_ACCES_SUSPENDU);
  }
  return etat;
}

/** État brut pour l'écran /acces-suspendu (aucune redirection). */
export async function etatIdentite(): Promise<EtatIdentite | EtatSuspendu> {
  return chargerIdentiteBrut();
}

/** Y a-t-il une session Supabase valide ? (pour la page d'accueil publique) */
export async function aUneSession(): Promise<boolean> {
  const etat = await chargerIdentiteBrut();
  return etat.kind !== 'anonyme';
}
