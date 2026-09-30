'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

const CIBLE = '/dashboard-assureur/informatique/evenements';

/**
 * Corps multipart pour l'API : champs texte nettoyés, case « actif » explicite
 * (absente du FormData quand décochée), image seulement si un fichier est
 * choisi. La description est toujours envoyée : vide = effacée.
 */
function corps(fd: FormData): FormData {
  const out = new FormData();
  for (const cle of ['titre', 'description', 'dateEvenement', 'ordreAffichage']) {
    const v = fd.get(cle);
    if (typeof v === 'string' && (v.trim() !== '' || cle === 'description')) out.set(cle, v.trim());
  }
  out.set('actif', fd.get('actif') === 'on' ? 'true' : 'false');
  const image = fd.get('image');
  if (image instanceof File && image.size > 0) out.set('image', image, image.name);
  return out;
}

function rafraichir() {
  revalidatePath(CIBLE);
  revalidatePath('/');
}

export async function creerEvenement(fd: FormData): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/vitrine/evenements', { method: 'POST', body: corps(fd) });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  rafraichir();
  return { ok: true, message: 'Événement créé.' };
}

export async function modifierEvenement(id: string, fd: FormData): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/vitrine/evenements/${id}`, { method: 'PATCH', body: corps(fd) });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  rafraichir();
  return { ok: true, message: 'Événement modifié.' };
}

export async function supprimerEvenement(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/vitrine/evenements/${id}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  rafraichir();
  return { ok: true };
}

/**
 * Bannière de la page d'accueil de la société (/{slug}). Titre et sous-titre
 * toujours envoyés (vide = retour au texte par défaut de la plateforme) ; image
 * seulement si un fichier est choisi ; case « image par défaut » → retrait.
 */
export async function modifierHero(fd: FormData): Promise<ResultatSoumission> {
  const out = new FormData();
  for (const cle of ['heroTitre', 'heroSousTitre']) {
    const v = fd.get(cle);
    out.set(cle, typeof v === 'string' ? v.trim() : '');
  }
  if (fd.get('supprimerImage') === 'on') out.set('supprimerImage', 'true');
  const image = fd.get('image');
  if (image instanceof File && image.size > 0) out.set('image', image, image.name);
  const res = await apiFetch('/api/v1/vitrine/hero', { method: 'PATCH', body: out });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Bannière enregistrée.' };
}
