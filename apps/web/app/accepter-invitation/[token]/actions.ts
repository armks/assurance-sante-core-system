'use server';

import { apiFetchPublic, messageErreur } from '@/lib/api';

export type ResultatAcceptation =
  | { ok: true; email: string; dashboardRoute: string }
  | { ok: false; error: string };

/**
 * Active le compte : l'invité pose son mot de passe. Celui-ci transite vers
 * l'API NestJS puis l'API Admin Supabase — il n'est jamais stocké ni journalisé.
 */
export async function accepterInvitation(input: {
  token: string;
  motDePasse: string;
}): Promise<ResultatAcceptation> {
  const res = await apiFetchPublic('/api/v1/invitations/accepter', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    return { ok: false, error: await messageErreur(res) };
  }
  const body = (await res.json()) as {
    email: string;
    dashboardRoute: string;
  };
  return {
    ok: true,
    email: body.email,
    dashboardRoute: body.dashboardRoute || '/dashboard',
  };
}
