'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

const CIBLE = '/dashboard-assureur/informatique/partenaires';

/**
 * Corps multipart pour l'API : champs texte nettoyés (le site est toujours envoyé : vide = pas de lien), case « actif » explicite (absente du
 * FormData quand décochée), logo seulement si un fichier est choisi.
 */
function corps(fd: FormData): FormData {
  const out = new FormData();
  for (const cle of ['nom', 'siteUrl', 'ordreAffichage']) {
    const v = fd.get(cle);
    if (typeof v === 'string' && (v.trim() !== '' || cle === 'siteUrl')) out.set(cle, v.trim());
  }
  out.set('actif', fd.get('actif') === 'on' ? 'true' : 'false');
  const image = fd.get('image');
  if (image instanceof File && image.size > 0) out.set('image', image, image.name);
  return out;
}

/** La page d'accueil publique (`/` et `/{slug}`) lit ces logos : elle est revalidée à chaque changement. */
function rafraichir() {
  revalidatePath(CIBLE);
  revalidatePath('/', 'layout');
}

export async function ajouterPartenaire(fd: FormData): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/vitrine/partenaires', { method: 'POST', body: corps(fd) });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  rafraichir();
  return { ok: true, message: 'Partenaire ajouté.' };
}

export async function modifierPartenaire(id: string, fd: FormData): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/vitrine/partenaires/${id}`, { method: 'PATCH', body: corps(fd) });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  rafraichir();
  return { ok: true, message: 'Partenaire modifié.' };
}

/** Masqué du bandeau (actif = false) ou affiché de nouveau, sans toucher au logo. */
export async function changerVisibilitePartenaire(id: string, actif: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const corpsActif = new FormData();
  corpsActif.set('actif', actif ? 'true' : 'false');
  const res = await apiFetch(`/api/v1/vitrine/partenaires/${id}`, { method: 'PATCH', body: corpsActif });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  rafraichir();
  return { ok: true };
}

export async function supprimerPartenaire(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/vitrine/partenaires/${id}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  rafraichir();
  return { ok: true };
}
