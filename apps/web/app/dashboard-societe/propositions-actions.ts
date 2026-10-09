'use server';

import { revalidatePath } from 'next/cache';

import type { ImportAdherentsResume } from '@/components/dashboard/adherents/types';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

/** Toutes les routes société qui affichent la liste des adhérents/propositions. */
const CIBLES = [
  '/dashboard-societe/administration/adherents',
  '/dashboard-societe/reception',
  '/dashboard-societe/assuree',
];
function revalider() {
  for (const c of CIBLES) revalidatePath(c);
}

type ResultatProposition =
  | { ok: true; import: ImportAdherentsResume }
  | { ok: false; error: string; erreurs?: string[] };

async function traiter(res: Response): Promise<ResultatProposition> {
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalider();
  return { ok: true, import: await res.json() };
}

export async function proposerAdherent(
  souscripteurId: string,
  input: {
    nom: string;
    prenom: string;
    telephone: string;
    email: string;
    dateNaissance: string;
    /** Mouvement de personnel à effet différé — s'applique à tout le lot. */
    moisEffet?: string;
  },
): Promise<ResultatProposition> {
  const res = await apiFetch(`/api/v1/member/souscripteurs/${souscripteurId}/propositions/adherent`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return traiter(res);
}

export async function proposerBeneficiaire(
  souscripteurId: string,
  input: {
    adherentId: string;
    lienParente: string;
    nom: string;
    prenom: string;
    dateNaissance: string;
    sexe: string;
  },
): Promise<ResultatProposition> {
  const res = await apiFetch(`/api/v1/member/souscripteurs/${souscripteurId}/propositions/beneficiaire`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return traiter(res);
}

export async function modifierPropositionAdherent(
  importId: string,
  index: number,
  input: { nom: string; prenom: string; telephone: string; email: string; dateNaissance: string },
): Promise<ResultatProposition> {
  const res = await apiFetch(`/api/v1/member/imports-adherents/${importId}/propositions/adherent/${index}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return traiter(res);
}

export async function modifierPropositionBeneficiaire(
  importId: string,
  index: number,
  input: {
    adherentId: string;
    lienParente: string;
    nom: string;
    prenom: string;
    dateNaissance: string;
    sexe: string;
  },
): Promise<ResultatProposition> {
  const res = await apiFetch(`/api/v1/member/imports-adherents/${importId}/propositions/beneficiaire/${index}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return traiter(res);
}

export async function supprimerProposition(
  importId: string,
  index: number,
): Promise<ResultatProposition> {
  const res = await apiFetch(`/api/v1/member/imports-adherents/${importId}/propositions/${index}`, {
    method: 'DELETE',
  });
  return traiter(res);
}

export async function soumettrePourValidation(
  importId: string,
): Promise<{ ok: true; statut: string } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/member/imports-adherents/${importId}/soumettre`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalider();
  const corps = await res.json();
  return { ok: true, statut: corps.statut };
}

/** Supprime la liste entière (BROUILLON seulement — vérifié par le registre des dépendances). */
export async function supprimerListePropositions(
  importId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/member/imports-adherents/${importId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) return { ok: false, error: await messageErreur(res) };
  revalider();
  return { ok: true };
}
