'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

const CIBLE = '/dashboard-assureur/informatique/produits';

/** Crée un produit en BROUILLON (garanties ajoutées ensuite dans la vue détail). */
export async function creerProduit(input: {
  nom: string;
}): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/plan/produits', {
    method: 'POST',
    body: JSON.stringify({ nom: input.nom }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const p = (await res.json()) as { nom: string; version: number };
  revalidatePath(CIBLE);
  return { ok: true, message: `Produit « ${p.nom} » v${p.version} créé en brouillon.` };
}

/** Renomme un produit (BROUILLON uniquement — 409 sinon côté API). */
export async function renommerProduit(
  produitId: string,
  input: { nom: string },
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/plan/produits/${produitId}`, {
    method: 'PATCH',
    body: JSON.stringify({ nom: input.nom }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(`${CIBLE}/${produitId}`);
  return { ok: true, message: 'Produit renommé.' };
}

export interface GarantieInput {
  categorieActe: string;
  tauxCouverture?: number;
  plafondParActe?: number;
  plafondAnnuel?: number;
  franchise?: number;
  ticketModerateur?: number;
  delaiCarenceJours?: number;
  reseauSoins?: string;
  exclusions?: string[];
}

/** Ajoute une ligne de garantie à un produit BROUILLON. */
export async function ajouterGarantie(
  produitId: string,
  input: GarantieInput,
): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(
      ([, v]) =>
        v !== undefined &&
        v !== '' &&
        !(Array.isArray(v) && v.length === 0) &&
        !(typeof v === 'number' && Number.isNaN(v)),
    ),
  );
  const res = await apiFetch(`/api/v1/plan/produits/${produitId}/garanties`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(`${CIBLE}/${produitId}`);
  return { ok: true, message: 'Garantie ajoutée.' };
}

/** Retire une garantie d'un produit BROUILLON. */
export async function supprimerGarantie(
  produitId: string,
  garantieId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(
    `/api/v1/plan/produits/${produitId}/garanties/${garantieId}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 204) {
    return { ok: false, error: await messageErreur(res) };
  }
  revalidatePath(`${CIBLE}/${produitId}`);
  return { ok: true };
}

/** Publie le produit — verrouille produit + garanties (immuable). */
export async function publierProduit(
  produitId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/plan/produits/${produitId}/publier`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(`${CIBLE}/${produitId}`);
  revalidatePath(CIBLE);
  return { ok: true };
}

/** Archive le produit (quel que soit son statut, sauf déjà ARCHIVE — 409 sinon). */
export async function archiverProduit(
  produitId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/plan/produits/${produitId}/archiver`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(`${CIBLE}/${produitId}`);
  revalidatePath(CIBLE);
  return { ok: true };
}

/** Modifie une garantie existante d'un produit BROUILLON (409 sinon côté API). */
export async function modifierGarantie(
  produitId: string,
  garantieId: string,
  input: GarantieInput,
): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(
      ([, v]) =>
        v !== undefined &&
        v !== '' &&
        !(Array.isArray(v) && v.length === 0) &&
        !(typeof v === 'number' && Number.isNaN(v)),
    ),
  );
  const res = await apiFetch(
    `/api/v1/plan/produits/${produitId}/garanties/${garantieId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(`${CIBLE}/${produitId}`);
  return { ok: true, message: 'Garantie modifiée.' };
}

/** Crée un nouveau BROUILLON version+1 en clonant produit + garanties. */
export async function creerNouvelleVersion(
  produitId: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const res = await apiFetch(
    `/api/v1/plan/produits/${produitId}/nouvelle-version`,
    { method: 'POST' },
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const p = (await res.json()) as { id: string };
  revalidatePath(CIBLE);
  return { ok: true, id: p.id };
}
