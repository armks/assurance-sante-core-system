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
  /** Accueil : le médecin qui a effectué l'acte (obligatoire côté API pour l'accueil). */
  medecinId?: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/preauthorization/actes/${acteId}/realiser`, {
    method: 'POST',
    body: JSON.stringify({ ...(dateRealisation ? { dateRealisation } : {}), ...(medecinId ? { medecinId } : {}) }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible(dossierId));
  return { ok: true, message: 'Acte marqué comme réalisé.' };
}

export type SituationActe = 'A_EFFECTUER' | 'PROPOSE' | 'EFFECTUE';

/**
 * Ajoute un acte selon sa SITUATION :
 *  - `A_EFFECTUER` : acte prescrit, à effectuer (aucune validation préalable de l'assurance) ;
 *  - `PROPOSE` : proposé à l'assurance pour VALIDATION AVANT exécution (pré-autorisation) ;
 *  - `EFFECTUE` : déjà effectué — l'accueil le déclare « sur information du médecin » (médecin désigné et tracé), le médecin l'atteste.
 * Si l'acte est créé mais que sa déclaration de réalisation est refusée, l'ajout est conservé (jamais de doublon à la nouvelle
 * soumission) et l'avertissement est renvoyé : la déclaration se refait depuis la ligne de l'acte.
 */
export async function ajouterActeSituation(
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
  situation: SituationActe,
  realisation?: { medecinId?: string; dateRealisation?: string },
): Promise<ResultatSoumission> {
  const corps = Object.fromEntries(
    Object.entries({ ...input, ...(situation === 'PROPOSE' ? { demanderPreautorisation: true } : {}) }).filter(
      ([, v]) => v !== undefined && v !== '',
    ),
  );
  const res = await apiFetch(`/api/v1/preauthorization/tickets-soins/${ticketSoinsId}/actes`, {
    method: 'POST',
    body: JSON.stringify(corps),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const acte = (await res.json().catch(() => null)) as
    | { id?: string; categorieCouverte?: boolean; montantPrescrit?: string | null; origineMontant?: string | null }
    | null;
  revalidatePath(cible(dossierId));

  const notes: string[] = [];
  if (acte?.categorieCouverte === false) {
    notes.push('catégorie NON COUVERTE par le produit du patient : aucune prise en charge, le patient paiera l’intégralité de cet acte');
  }
  if (acte?.origineMontant === 'TARIF_CONVENTION' && acte.montantPrescrit) {
    notes.push(`montant repris de la convention : ${Number(acte.montantPrescrit).toLocaleString('fr-FR')} F`);
  }
  if (situation === 'PROPOSE') notes.push('proposé à l’assurance pour validation avant exécution');

  if (situation === 'EFFECTUE' && acte?.id) {
    const r = await marquerActeRealise(dossierId, acte.id, realisation?.dateRealisation, realisation?.medecinId);
    if (!r.ok) {
      return {
        ok: true,
        message: `Acte ajouté, mais sa réalisation n’a pas pu être déclarée (${r.error}). Utilisez « Déclarer réalisé » sur la ligne de l’acte.`,
      };
    }
    notes.push('réalisation déclarée');
  }
  return { ok: true, message: `Acte ajouté${notes.length ? ` — ${notes.join(' ; ')}` : ' au ticket de soins'}.` };
}

export interface ActeCatalogue {
  id: string;
  code: string;
  libelle: string;
  /** Catégorie de garantie de l'acte (ou catégorie libre du catalogue) — l'écran ne la retient que si elle est valide. */
  categorieActe: string | null;
  /** Tarif unitaire de la convention de l'établissement du dossier ; `null` = pas de tarif en base ; absent = non demandé. */
  tarifUnitaire?: number | null;
}

/** Recherche d'un acte dans le référentiel homologué du système, limitée à la catégorie choisie (libellé ou code) — 20 résultats, chacun avec son tarif unitaire pour ce dossier. */
export async function rechercherActesCatalogue(q: string, categorie: string, dossierId: string): Promise<ActeCatalogue[]> {
  // la catégorie est choisie avant la recherche : seule, elle liste ses premiers actes ; sinon 2 caractères minimum
  if (!categorie && q.trim().length < 2) return [];
  const params = new URLSearchParams({ q: q.trim(), categorie, dossierId });
  const res = await apiFetch(`/api/v1/preauthorization/actes/catalogue?${params.toString()}`);
  return res.ok ? ((await res.json()) as ActeCatalogue[]) : [];
}

/** Tarif unitaire reconnu par la convention de l'établissement du dossier pour cet acte ; `null` = pas de tarif en base (saisie libre). */
export async function tarifReferenceActe(dossierId: string, codeActe: string, categorieActe: string): Promise<number | null> {
  const params = new URLSearchParams({ dossierId, codeActe, categorieActe });
  const res = await apiFetch(`/api/v1/preauthorization/actes/tarif-reference?${params.toString()}`);
  if (!res.ok) return null;
  const r = (await res.json()) as { tarifUnitaire: number | null };
  return r.tarifUnitaire ?? null;
}
