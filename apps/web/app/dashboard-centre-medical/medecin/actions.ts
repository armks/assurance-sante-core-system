'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

function cible(dossierId: string) {
  return `/dashboard-centre-medical/medecin/${dossierId}`;
}

/** Le médecin connecté ajoute une consultation au dossier (`medecinId` = lui-même). */
export async function ajouterConsultation(
  dossierId: string,
  medecinId: string,
  input: {
    motif: string;
    observations?: string;
    diagnostic?: string;
    codeCim10?: string;
  },
): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries({ ...input, medecinId }).filter(
      ([, v]) => v !== undefined && v !== '',
    ),
  );
  const res = await apiFetch(
    `/api/v1/care-episode/dossiers/${dossierId}/consultations`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible(dossierId));
  return { ok: true, message: 'Consultation ajoutée.' };
}

/** Ajoute un acte au ticket de soins ouvert du dossier. */
export async function ajouterActe(
  dossierId: string,
  ticketSoinsId: string,
  input: {
    categorieActe: string;
    libelle: string;
    codeActe?: string;
    consultationId?: string;
    medecinPrescripteurId?: string;
    quantite?: number;
    montantPrescrit?: number;
  },
): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  );
  const res = await apiFetch(
    `/api/v1/preauthorization/tickets-soins/${ticketSoinsId}/actes`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible(dossierId));
  // Règle « non couvert » : l'API annonce, dès l'ajout, si la catégorie de
  // l'acte a une garantie dans le produit du patient.
  const acte = (await res.json().catch(() => null)) as
    | { categorieCouverte?: boolean }
    | null;
  if (acte?.categorieCouverte === false) {
    return {
      ok: true,
      message:
        'Acte ajouté — catégorie NON COUVERTE par le produit du patient : aucune prise en charge, le patient paiera l’intégralité de cet acte.',
    };
  }
  return { ok: true, message: 'Acte ajouté au ticket de soins.' };
}

/**
 * Choisit le type de visite — UNE SEULE FOIS, à l'intérieur du dossier, après
 * son ouverture (l'API refuse avec un 409 si déjà défini, ou si le dossier
 * n'est plus OUVERT).
 */
export async function definirTypeVisite(
  dossierId: string,
  typeVisite: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch(
    `/api/v1/care-episode/dossiers/${dossierId}/type-visite`,
    { method: 'POST', body: JSON.stringify({ typeVisite }) },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible(dossierId));
  return { ok: true, message: 'Type de visite enregistré.' };
}

/**
 * Émet une ordonnance à partir d'une consultation. Le code de retrait n'est
 * JAMAIS renvoyé ici — il est transmis directement à l'adhérent (APP/SMS).
 */
export async function emettreOrdonnance(
  dossierId: string,
  input: {
    consultationId: string;
    medecinId: string;
    lignes: { medicament: string; posologie: string; dosage?: string; duree?: string }[];
  },
): Promise<ResultatSoumission> {
  if (input.lignes.length === 0) {
    return {
      ok: false,
      error: 'Ajoutez au moins un médicament.',
      erreurs: [],
    };
  }
  const res = await apiFetch('/api/v1/preauthorization/ordonnances', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible(dossierId));
  return {
    ok: true,
    message:
      'Ordonnance établie. Le code de retrait a été envoyé à l’adhérent (APP/SMS).',
  };
}

/** Clôture normale du dossier (clôture aussi le ticket de soins). */
export async function cloturerDossier(
  dossierId: string,
  input: { motif?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = input.motif ? { motif: input.motif } : {};
  const res = await apiFetch(
    `/api/v1/care-episode/dossiers/${dossierId}/cloturer`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(cible(dossierId));
  revalidatePath('/dashboard-centre-medical/medecin');
  return { ok: true };
}

/**
 * Le médecin traitant atteste qu'un acte a été effectué — condition pour qu'il
 * soit facturable. `dateRealisation` (ISO, déjà convertie depuis l'heure
 * locale du poste) : maintenant si absente.
 */
export async function marquerActeRealise(
  dossierId: string,
  acteId: string,
  dateRealisation?: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/preauthorization/actes/${acteId}/realiser`, {
    method: 'POST',
    body: JSON.stringify(dateRealisation ? { dateRealisation } : {}),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible(dossierId));
  return { ok: true, message: 'Acte marqué comme réalisé.' };
}
