'use server';

import { apiFetch, messageErreur } from '@/lib/api';
import type { CarteGeneree } from './types';

export async function genererMaCarte(
  adherentId: string,
): Promise<{ ok: true; carte: CarteGeneree } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/member/adherents/${adherentId}/carte`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const carte = (await res.json()) as CarteGeneree;
  return { ok: true, carte };
}
