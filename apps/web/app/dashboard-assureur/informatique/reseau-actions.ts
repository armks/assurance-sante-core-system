'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, messageErreur } from '@/lib/api';

const RACINE = '/dashboard-assureur/informatique';

export type ResultatReseau =
  | { ok: true; message: string }
  | { ok: false; error: string };

function nettoyer(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === '' || v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

export async function creerEtablissement(input: {
  nom: string;
  code: string;
  typeEtablissement: string;
  ville?: string;
  commune?: string;
  telephone?: string;
  latitude?: number;
  longitude?: number;
  gardeWeekend?: boolean;
}): Promise<ResultatReseau> {
  const res = await apiFetch('/api/v1/provider/etablissements', {
    method: 'POST',
    body: JSON.stringify(nettoyer(input)),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const e = (await res.json()) as { nom: string; statut: string };
  revalidatePath(`${RACINE}/etablissements`);
  return { ok: true, message: `« ${e.nom} » créé (statut ${e.statut}).` };
}

export async function creerPharmacie(input: {
  nom: string;
  code: string;
  ville?: string;
  commune?: string;
  telephone?: string;
  latitude?: number;
  longitude?: number;
  gardeWeekend?: boolean;
}): Promise<ResultatReseau> {
  const res = await apiFetch('/api/v1/provider/pharmacies', {
    method: 'POST',
    body: JSON.stringify(nettoyer(input)),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const p = (await res.json()) as { nom: string; statut: string };
  revalidatePath(`${RACINE}/pharmacies`);
  return { ok: true, message: `« ${p.nom} » créée (statut ${p.statut}).` };
}
