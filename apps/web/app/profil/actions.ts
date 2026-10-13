'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, messageErreur } from '@/lib/api';

type Resultat = { ok: true } | { ok: false; error: string };

export async function modifierPseudo(pseudo: string): Promise<Resultat> {
  const res = await apiFetch('/api/v1/identity/me/profil', { method: 'PATCH', body: JSON.stringify({ pseudo }) });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function televerserPhoto(donnees: FormData): Promise<Resultat> {
  const res = await apiFetch('/api/v1/identity/me/photo', { method: 'POST', body: donnees });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function supprimerPhoto(): Promise<Resultat> {
  const res = await apiFetch('/api/v1/identity/me/photo', { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath('/', 'layout');
  return { ok: true };
}
