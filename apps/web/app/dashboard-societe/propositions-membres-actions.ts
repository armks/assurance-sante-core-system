'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch } from '@/lib/api';

/** Écrans qui affichent la liste des propositions (société) ou leur validation (assureur). */
const CIBLES = [
  '/dashboard-societe/administration/adherents',
  '/dashboard-societe/reception',
  '/dashboard-societe/assuree',
  '/dashboard-assureur/informatique/adherents',
];
const revalider = () => CIBLES.forEach((c) => revalidatePath(c));

export type ResultatPropositionMembre = { ok: true } | { ok: false; error: string; erreurs?: string[] };

async function traiter(res: Response): Promise<ResultatPropositionMembre> {
  if (res.ok) {
    revalider();
    return { ok: true };
  }
  try {
    const body = (await res.json()) as { message?: string | string[]; erreurs?: string[] };
    const erreurs = body.erreurs ?? (Array.isArray(body.message) ? body.message : undefined);
    return { ok: false, error: Array.isArray(body.message) ? 'Certains champs sont invalides.' : (body.message ?? `Erreur ${res.status}`), erreurs };
  } catch {
    return { ok: false, error: `Erreur ${res.status}` };
  }
}

const post = (chemin: string, corps?: object) =>
  apiFetch(`/api/v1/member/propositions-membres${chemin}`, { method: 'POST', ...(corps ? { body: JSON.stringify(corps) } : {}) });

export async function proposerAdherentMembre(input: {
  nom: string;
  prenom: string;
  dateNaissance: string;
  sexe: string;
  policeId: string;
  telephone?: string;
  email?: string;
}): Promise<ResultatPropositionMembre> {
  return traiter(await post('/adherent', input));
}

export async function proposerBeneficiaireMembre(input: {
  adherentId: string;
  lienParente: string;
  nom: string;
  prenom: string;
  dateNaissance: string;
  sexe: string;
}): Promise<ResultatPropositionMembre> {
  return traiter(await post('/beneficiaire', input));
}

export async function retirerPropositionMembre(id: string): Promise<ResultatPropositionMembre> {
  return traiter(await apiFetch(`/api/v1/member/propositions-membres/${id}`, { method: 'DELETE' }));
}

export async function validerPropositionMembre(id: string): Promise<ResultatPropositionMembre> {
  return traiter(await post(`/${id}/valider`));
}

export async function rejeterPropositionMembre(id: string, motif: string): Promise<ResultatPropositionMembre> {
  return traiter(await post(`/${id}/rejeter`, { motif }));
}

/** Lien d'invitation (rôle ADHERENT_TITULAIRE) d'un adhérent VALIDÉ — contrôlé par l'API (périmètre, validation, compte existant). */
export async function inviterAdherent(
  adherentId: string,
  email: string,
): Promise<{ ok: true; token: string; emailEnvoye: boolean | null } | { ok: false; error: string }> {
  const res = await apiFetch('/api/v1/invitations', { method: 'POST', body: JSON.stringify({ email, rolePropose: 'ADHERENT_TITULAIRE', adherentId }) });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    return { ok: false, error: Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? `Erreur ${res.status}`) };
  }
  const inv = (await res.json()) as { token?: string; emailEnvoye?: boolean | null };
  revalider();
  return { ok: true, token: inv.token ?? '', emailEnvoye: inv.emailEnvoye ?? null };
}
