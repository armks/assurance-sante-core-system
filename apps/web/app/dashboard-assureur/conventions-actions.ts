'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

/**
 * Actions serveur des conventions (ADR-008, lot 2). L'API décide de tout (rôle, circuit, chevauchement,
 * auto-validation) ; ces fonctions ne font que transmettre et rafraîchir les trois espaces qui les affichent.
 */
const BASES = ['informatique', 'medecin-conseil', 'direction'].map((b) => `/dashboard-assureur/${b}/conventions`);
const rafraichir = () => {
  for (const b of BASES) revalidatePath(b, 'layout');
};

type Simple = { ok: true; message?: string } | { ok: false; error: string };

async function appeler(chemin: string, methode: string, corps?: unknown): Promise<Response> {
  return apiFetch(`/api/v1/conventions${chemin}`, {
    method: methode,
    ...(corps !== undefined ? { body: JSON.stringify(corps) } : {}),
  });
}

async function simple(res: Response, message: string): Promise<Simple> {
  if (!res.ok && res.status !== 204) return { ok: false, error: await messageErreur(res) };
  rafraichir();
  return { ok: true, message };
}

export async function creerConvention(input: {
  etablissementId: string;
  numero: string;
  dateDebut: string;
  dateFin?: string;
  politiqueDepassement?: string;
}): Promise<ResultatSoumission & { id?: string }> {
  const res = await appeler('', 'POST', Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== '')));
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const c = (await res.json()) as { id: string };
  rafraichir();
  return { ok: true, message: 'Convention créée.', id: c.id };
}

export async function modifierConvention(
  id: string,
  input: { numero?: string; dateDebut?: string; dateFin?: string | null; politiqueDepassement?: string },
): Promise<ResultatSoumission> {
  const res = await appeler(`/${id}`, 'PATCH', input);
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  rafraichir();
  return { ok: true, message: 'Convention modifiée.' };
}

export async function enregistrerValeurs(
  id: string,
  valeurs: { lettreCleCode: string; contexte: string; valeur: number }[],
): Promise<Simple> {
  const res = await appeler(`/${id}/valeurs`, 'PUT', { valeurs });
  return simple(res, 'Valeurs enregistrées.');
}

export async function enregistrerActes(
  id: string,
  actes: { referentielActeId: string; prixForfaitaire?: number; valeurLettreCle?: number }[],
): Promise<Simple> {
  const res = await appeler(`/${id}/actes`, 'PUT', { actes });
  return simple(res, 'Exceptions par acte enregistrées.');
}

export async function joindreDocument(id: string, formData: FormData): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/conventions/${id}/document`, { method: 'POST', body: formData });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  rafraichir();
  return { ok: true, message: 'Document joint.' };
}

export async function urlDocument(id: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const res = await appeler(`/${id}/document`, 'GET');
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  return { ok: true, url: ((await res.json()) as { url: string }).url };
}

export async function validerConvention(id: string): Promise<Simple> {
  return simple(await appeler(`/${id}/valider`, 'POST'), 'Convention validée : elle est en vigueur à sa date d’effet.');
}

export async function refuserConvention(id: string, motif: string): Promise<Simple> {
  return simple(await appeler(`/${id}/refuser`, 'POST', { motif }), 'Convention refusée : l’assurance informatique en est informée.');
}

export async function reproposerConvention(id: string): Promise<Simple> {
  return simple(await appeler(`/${id}/reproposer`, 'POST'), 'Convention reproposée.');
}

export async function nouvelleVersion(id: string, dateDebut: string): Promise<ResultatSoumission & { id?: string }> {
  const res = await appeler(`/${id}/nouvelle-version`, 'POST', { dateDebut });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const c = (await res.json()) as { id: string };
  rafraichir();
  return { ok: true, message: 'Nouvelle version créée.', id: c.id };
}

export async function archiverConvention(id: string): Promise<Simple> {
  return simple(await appeler(`/${id}/archiver`, 'POST', {}), 'Convention archivée.');
}

export async function supprimerConvention(id: string): Promise<Simple> {
  return simple(await appeler(`/${id}`, 'DELETE'), 'Convention supprimée.');
}
