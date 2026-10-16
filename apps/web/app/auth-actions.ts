'use server';

import { headers } from 'next/headers';

import { messageErreurAuth } from '@/lib/auth-erreurs';
import { genererCaptcha, verifierCaptcha, type DefiCaptcha } from '@/lib/captcha';
import { createClient } from '@/lib/supabase/server';

/** Nouveau défi CAPTCHA (image + jeton signé) pour la connexion et la création de compte. */
export async function nouveauCaptcha(): Promise<DefiCaptcha> {
  return genererCaptcha();
}

export type ResultatAuth = { ok: true } | { ok: false; error: string };

interface Verification {
  captchaJeton: string;
  captchaReponse: string;
}

/**
 * Connexion CÔTÉ SERVEUR : le CAPTCHA est vérifié AVANT toute tentative d'authentification (une réponse fausse ne teste donc jamais
 * le mot de passe), puis la session est posée dans les cookies de la réponse.
 */
export async function seConnecter(input: { email: string; password: string } & Verification): Promise<ResultatAuth> {
  const captcha = verifierCaptcha(input.captchaJeton, input.captchaReponse);
  if (!captcha.ok) return captcha;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
  if (error) return { ok: false, error: messageErreurAuth(error) };
  return { ok: true };
}

/** Création de compte côté serveur, CAPTCHA vérifié avant l'appel à Supabase. */
export async function sInscrire(input: { email: string; password: string } & Verification): Promise<ResultatAuth> {
  const captcha = verifierCaptcha(input.captchaJeton, input.captchaReponse);
  if (!captcha.ok) return captcha;
  const h = await headers();
  const hote = h.get('x-forwarded-host') ?? h.get('host');
  const protocole = h.get('x-forwarded-proto') ?? 'http';
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: { emailRedirectTo: `${protocole}://${hote}/dashboard` },
  });
  if (error) return { ok: false, error: messageErreurAuth(error) };
  return { ok: true };
}
