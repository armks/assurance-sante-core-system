'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import type { ImportAdherentsResume } from '@/components/dashboard/adherents/types';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

/** Toutes les routes qui affichent le fichier des membres (assureur + société). */
const CIBLES = [
  '/dashboard-assureur/informatique/adherents',
  '/dashboard-societe/administration/adherents',
];
function revalider(suffixe = '') {
  for (const c of CIBLES) revalidatePath(`${c}${suffixe}`);
}

export async function creerAdherent(input: {
  souscripteurId: string;
  policeId?: string;
  nom: string;
  prenom: string;
  dateNaissance: string;
  sexe: string;
  modePaiementPrefere?: string;
}): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  );
  const res = await apiFetch('/api/v1/member/adherents', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const a = (await res.json()) as { numeroAdherent: string };
  revalider();
  return { ok: true, message: `Adhérent ${a.numeroAdherent} créé.` };
}

export async function changerStatutAdherent(
  id: string,
  input: { statut: string; motif?: string },
): Promise<{ ok: true; statut: string } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/member/adherents/${id}/statut`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const a = (await res.json()) as { statut: string };
  revalider();
  revalider(`/${id}`);
  return { ok: true, statut: a.statut };
}

/** Réservé EXCLUSIVEMENT à ASSUREUR_EXPLOITATION côté API — gouverne la
 * coupure de facturation mensuelle (billing/). */
export async function validerAdherent(
  id: string,
): Promise<{ ok: true; dateValidation: string } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/member/adherents/${id}/valider`, { method: 'POST' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const a = (await res.json()) as { dateValidation: string };
  revalider();
  revalider(`/${id}`);
  return { ok: true, dateValidation: a.dateValidation };
}

export async function ajouterBeneficiaire(
  adherentId: string,
  input: {
    lienParente: string;
    nom: string;
    prenom: string;
    dateNaissance: string;
    sexe: string;
  },
): Promise<ResultatSoumission> {
  const res = await apiFetch(
    `/api/v1/member/adherents/${adherentId}/beneficiaires`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalider(`/${adherentId}`);
  return { ok: true, message: 'Bénéficiaire ajouté.' };
}

/** Modifie l'identité d'un bénéficiaire existant (nom, prénom, naissance, sexe, lien). */
export async function modifierBeneficiaire(
  adherentId: string,
  beneficiaireId: string,
  input: {
    lienParente?: string;
    nom?: string;
    prenom?: string;
    dateNaissance?: string;
    sexe?: string;
  },
): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  );
  const res = await apiFetch(
    `/api/v1/member/adherents/${adherentId}/beneficiaires/${beneficiaireId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalider(`/${adherentId}`);
  return { ok: true, message: 'Bénéficiaire modifié.' };
}

/** Supprime (soft delete) un bénéficiaire. */
export async function supprimerBeneficiaire(
  adherentId: string,
  beneficiaireId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(
    `/api/v1/member/adherents/${adherentId}/beneficiaires/${beneficiaireId}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 204) {
    return { ok: false, error: await messageErreur(res) };
  }
  revalider(`/${adherentId}`);
  return { ok: true };
}

export async function changerStatutBeneficiaire(
  adherentId: string,
  beneficiaireId: string,
  input: { statut: string; motif?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(
    `/api/v1/member/adherents/${adherentId}/beneficiaires/${beneficiaireId}/statut`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalider(`/${adherentId}`);
  return { ok: true };
}

type ResultatCarte =
  | { ok: true; url: string; numeroCarte: string; qrCode: string; expiresIn: number }
  | { ok: false; error: string };

export async function genererCarteAdherent(id: string): Promise<ResultatCarte> {
  const res = await apiFetch(`/api/v1/member/adherents/${id}/carte`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  return { ok: true, ...(await res.json()) };
}

export async function genererCarteBeneficiaire(
  adherentId: string,
  beneficiaireId: string,
): Promise<ResultatCarte> {
  const res = await apiFetch(
    `/api/v1/member/adherents/${adherentId}/beneficiaires/${beneficiaireId}/carte`,
    { method: 'POST' },
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  return { ok: true, ...(await res.json()) };
}

// --- Import en masse depuis Excel (réservé ASSUREUR_INFORMATIQUE/
// ASSUREUR_COMPTABLE ; validation réservée ASSUREUR_INFORMATIQUE/
// ASSUREUR_EXPLOITATION) — aucun adhérent créé avant validation. --------

export async function importerAdherentsExcel(
  souscripteurId: string,
  fd: FormData,
): Promise<{ ok: true; import: ImportAdherentsResume } | { ok: false; error: string; erreurs: string[] }> {
  const res = await apiFetch(`/api/v1/member/souscripteurs/${souscripteurId}/imports-adherents`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalider();
  return { ok: true, import: await res.json() };
}

export async function validerImportAdherents(
  importId: string,
): Promise<{ ok: true; nbAdherentsCrees: number } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/member/imports-adherents/${importId}/valider`, { method: 'POST' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalider();
  const corps = await res.json();
  return { ok: true, nbAdherentsCrees: corps.nbAdherentsCrees };
}

// --- Double validation d'un bénéficiaire proposé par l'adhérent lui-même
// (EN_ATTENTE_SOCIETE → EN_ATTENTE_ASSUREUR → ACTIF, carte générée à ce
// dernier moment). ---------------------------------------------------

export async function validerBeneficiaireSociete(
  beneficiaireId: string,
): Promise<{ ok: true; statut: string } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/member/beneficiaires/${beneficiaireId}/valider-societe`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalider();
  const corps = await res.json();
  return { ok: true, statut: corps.statut };
}

export async function validerBeneficiaireAssureur(
  beneficiaireId: string,
): Promise<{ ok: true; statut: string; numeroCarte: string | null } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/member/beneficiaires/${beneficiaireId}/valider-assureur`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalider();
  const corps = await res.json();
  return { ok: true, statut: corps.statut, numeroCarte: corps.numeroCarte };
}

// --- Mouvements de personnel — sortants (proposés par SOCIETE_ADMINISTRATION,
// validation réservée ici à ASSUREUR_INFORMATIQUE/EXPLOITATION). Effet
// immédiat une fois validé. ------------------------------------------

export async function validerSortants(
  adherentIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch('/api/v1/member/sortants/valider', {
    method: 'POST',
    body: JSON.stringify({ adherentIds }),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalider();
  return { ok: true };
}

// --- Photo de profil par le personnel (ASSUREUR_INFORMATIQUE/EXPLOITATION) —
// mêmes endpoints que le self-service adhérent ; l'API vérifie le rôle et
// l'organisation, et applique la même convention de dossier famille. ---

type ResultatPhoto =
  | { ok: true; url: string; expiresIn: number }
  | { ok: false; error: string };

export async function televerserPhotoAdherentPersonnel(
  adherentId: string,
  fd: FormData,
): Promise<ResultatPhoto> {
  const res = await apiFetch(`/api/v1/member/adherents/${adherentId}/photo`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalider(`/${adherentId}`);
  return { ok: true, ...(await res.json()) };
}

export async function televerserPhotoBeneficiairePersonnel(
  adherentId: string,
  beneficiaireId: string,
  fd: FormData,
): Promise<ResultatPhoto> {
  const res = await apiFetch(
    `/api/v1/member/adherents/${adherentId}/beneficiaires/${beneficiaireId}/photo`,
    { method: 'POST', body: fd },
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalider(`/${adherentId}`);
  return { ok: true, ...(await res.json()) };
}

export async function obtenirPhotoAdherentPersonnel(adherentId: string): Promise<ResultatPhoto> {
  const res = await apiFetch(`/api/v1/member/adherents/${adherentId}/photo`);
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  return { ok: true, ...(await res.json()) };
}

export async function obtenirPhotoBeneficiairePersonnel(
  adherentId: string,
  beneficiaireId: string,
): Promise<ResultatPhoto> {
  const res = await apiFetch(
    `/api/v1/member/adherents/${adherentId}/beneficiaires/${beneficiaireId}/photo`,
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  return { ok: true, ...(await res.json()) };
}
