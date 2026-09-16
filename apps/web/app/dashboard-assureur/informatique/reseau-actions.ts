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

interface Avertissement {
  type: string;
  message: string;
}
interface LieuCree {
  nom: string;
  statut: string;
  latitude: number | null;
  longitude: number | null;
  avertissements?: Avertissement[];
}

function messageCreation(l: LieuCree, feminin: boolean): string {
  const base = `« ${l.nom} » cré${feminin ? 'ée' : 'é'} (statut ${l.statut})`;
  const geo =
    l.latitude != null && l.longitude != null
      ? ` — coordonnées ${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}`
      : '';
  const av = (l.avertissements ?? [])
    .filter((a) => a.type !== 'GEOCODAGE_AUTO')
    .map((a) => ` ⚠ ${a.message}`)
    .join('');
  return `${base}${geo}.${av}`;
}

export async function creerEtablissement(input: {
  nom: string;
  code: string;
  typeEtablissement: string;
  ville?: string;
  commune?: string;
  adresseComplete?: string;
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
  const e = (await res.json()) as LieuCree;
  revalidatePath(`${RACINE}/etablissements`);
  return { ok: true, message: messageCreation(e, false) };
}

export async function creerPharmacie(input: {
  nom: string;
  code: string;
  ville?: string;
  commune?: string;
  adresseComplete?: string;
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
  const p = (await res.json()) as LieuCree;
  revalidatePath(`${RACINE}/pharmacies`);
  return { ok: true, message: messageCreation(p, true) };
}

/** Fait passer un établissement EN_ATTENTE_VALIDATION à ACTIF. */
export async function validerEtablissement(id: string): Promise<ResultatReseau> {
  const res = await apiFetch(`/api/v1/provider/etablissements/${id}/valider`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const e = (await res.json()) as { nom: string };
  revalidatePath(`${RACINE}/etablissements`);
  return { ok: true, message: `« ${e.nom} » est maintenant ACTIF.` };
}

/** Tâche déclenchable : marque « À revérifier » les entrées trop anciennes. */
export async function reverifierObsoletes(): Promise<ResultatReseau> {
  const res = await apiFetch('/api/v1/provider/verifications/reverifier-obsoletes', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const r = (await res.json()) as {
    etablissementsMarques: number;
    pharmaciesMarquees: number;
    moisMax: number;
  };
  revalidatePath(`${RACINE}/etablissements`);
  revalidatePath(`${RACINE}/pharmacies`);
  return {
    ok: true,
    message: `${r.etablissementsMarques} établissement(s) et ${r.pharmaciesMarquees} pharmacie(s) marqués « À revérifier » (non vérifiés depuis > ${r.moisMax} mois).`,
  };
}
