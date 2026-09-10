'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, detailErreur, messageErreur } from '@/lib/api';
import type { ResultatSoumission } from '@/components/dashboard/patterns';

const CIBLE = '/dashboard-assureur/informatique/souscripteurs';

/** Crée un souscripteur (ENTREPRISE / COLLECTIVITE / INDIVIDUEL). */
export async function creerSouscripteur(input: {
  type: string;
  nom: string;
  secteurActivite?: string;
  effectifDeclare?: number;
  typeCollectivite?: string;
  organeGouvernance?: string;
  subventionExterne?: boolean;
  bailleurSubvention?: string;
  numeroPieceIdentite?: string;
}): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  );
  const res = await apiFetch('/api/v1/tenant/souscripteurs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const s = (await res.json()) as { nom: string };
  revalidatePath(CIBLE);
  return { ok: true, message: `Souscripteur « ${s.nom} » créé.` };
}

/** Ajoute un membre au comité de gestion d'une COLLECTIVITE. */
export async function ajouterMembreComite(
  souscripteurId: string,
  input: { userId: string; fonction: string; dateDebutMandat?: string },
): Promise<ResultatSoumission> {
  const res = await apiFetch(
    `/api/v1/tenant/souscripteurs/${souscripteurId}/membres-comite`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(`${CIBLE}/${souscripteurId}`);
  return { ok: true, message: 'Membre ajouté au comité.' };
}

/**
 * Génère (PDF multi-pages) les cartes de tous les adhérents ACTIFS d'un
 * souscripteur et renvoie une URL signée temporaire vers le fichier.
 */
export async function genererCartesSouscripteur(
  souscripteurId: string,
): Promise<
  | { ok: true; url: string; nombreCartes: number; expiresIn: number }
  | { ok: false; error: string }
> {
  const res = await apiFetch(
    `/api/v1/member/souscripteurs/${souscripteurId}/cartes`,
    { method: 'POST' },
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const body = (await res.json()) as {
    url: string;
    nombreCartes: number;
    expiresIn: number;
  };
  return { ok: true, ...body };
}

/** Retire un membre du comité (clôture de mandat). */
export async function retirerMembreComite(
  souscripteurId: string,
  membreId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(
    `/api/v1/tenant/souscripteurs/${souscripteurId}/membres-comite/${membreId}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 204) {
    return { ok: false, error: await messageErreur(res) };
  }
  revalidatePath(`${CIBLE}/${souscripteurId}`);
  return { ok: true };
}
