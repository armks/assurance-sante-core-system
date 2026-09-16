'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, messageErreur } from '@/lib/api';

const RACINE = '/dashboard-assureur/informatique';

export type ResultatReseau =
  | { ok: true; message: string }
  | { ok: false; error: string };

function nettoyer<T extends object>(input: T) {
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

interface ModifierLieuInput {
  nom?: string;
  ville?: string;
  commune?: string;
  adresseComplete?: string;
  telephone?: string;
  email?: string;
  latitude?: number;
  longitude?: number;
  gardeWeekend?: boolean;
}

export async function modifierEtablissement(
  id: string,
  input: ModifierLieuInput & { typeEtablissement?: string },
): Promise<ResultatReseau> {
  const res = await apiFetch(`/api/v1/provider/etablissements/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(nettoyer(input)),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(`${RACINE}/etablissements`);
  return { ok: true, message: 'Établissement modifié.' };
}

export async function modifierPharmacie(
  id: string,
  input: ModifierLieuInput,
): Promise<ResultatReseau> {
  const res = await apiFetch(`/api/v1/provider/pharmacies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(nettoyer(input)),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(`${RACINE}/pharmacies`);
  return { ok: true, message: 'Pharmacie modifiée.' };
}

export async function supprimerEtablissement(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/provider/etablissements/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    return { ok: false, error: await messageErreur(res) };
  }
  revalidatePath(`${RACINE}/etablissements`);
  return { ok: true };
}

export async function supprimerPharmacie(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/provider/pharmacies/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    return { ok: false, error: await messageErreur(res) };
  }
  revalidatePath(`${RACINE}/pharmacies`);
  return { ok: true };
}

export interface ResultatLieu {
  id: string;
  nom: string;
  ville: string | null;
  commune: string | null;
  distanceKm: number;
}
export interface ResultatRechercheGeo {
  centre: { lat: number; lng: number };
  rayonKm: number;
  etablissements?: ResultatLieu[];
  pharmacies?: ResultatLieu[];
}

/** Recherche géolocalisée dans le réseau (endpoint déjà existant, jamais exposé côté écran). */
export async function rechercheGeolocalisee(input: {
  lat: number;
  lng: number;
  rayonKm?: number;
  cible?: 'ETABLISSEMENTS' | 'PHARMACIES' | 'TOUS';
}): Promise<{ ok: true; resultat: ResultatRechercheGeo } | { ok: false; error: string }> {
  const params = new URLSearchParams({
    lat: String(input.lat),
    lng: String(input.lng),
  });
  if (input.rayonKm !== undefined) params.set('rayonKm', String(input.rayonKm));
  if (input.cible) params.set('cible', input.cible);
  const res = await apiFetch(`/api/v1/provider/recherche?${params.toString()}`);
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  return { ok: true, resultat: (await res.json()) as ResultatRechercheGeo };
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
