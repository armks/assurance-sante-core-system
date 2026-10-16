'use server';

import { apiFetchPublic, messageErreur } from '@/lib/api';
import { verifierCaptcha } from '@/lib/captcha';

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
  captchaJeton: string;
  captchaReponse: string;
}): Promise<ResultatAcceptation> {
  // CAPTCHA vérifié AVANT toute activation (le mot de passe n'est même pas transmis à l'API en cas d'échec)
  const captcha = verifierCaptcha(input.captchaJeton, input.captchaReponse);
  if (!captcha.ok) return captcha;
  const res = await apiFetchPublic('/api/v1/invitations/accepter', {
    method: 'POST',
    body: JSON.stringify({ token: input.token, motDePasse: input.motDePasse }),
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
