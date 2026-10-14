'use server';

import { apiFetch } from '@/lib/api';

/**
 * Valide le code de consultation présenté par le patient. En cas de succès le
 * dossier de soins est ouvert (numéro de traitement retourné) ; en cas de refus,
 * l'API renvoie la liste PRÉCISE des blocages (moteur d'éligibilité).
 */
export async function validerCodeConsultation(input: {
  code: string;
  motifConsultation: string;
  etablissementId: string;
}): Promise<
  | { ok: true; dossierId: string; numeroTraitement: string }
  | { ok: false; error: string; blocages: string[] }
> {
  const res = await apiFetch(
    '/api/v1/preauthorization/codes-consultation/valider',
    { method: 'POST', body: JSON.stringify(input) },
  );

  if (res.ok) {
    const body = (await res.json()) as {
      dossier: { id: string; numeroTraitement: string };
    };
    return {
      ok: true,
      dossierId: body.dossier.id,
      numeroTraitement: body.dossier.numeroTraitement,
    };
  }

  const body = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    blocages?: string[];
  };
  const error = Array.isArray(body.message)
    ? body.message.join(' ')
    : (body.message ?? `Erreur ${res.status}`);
  return { ok: false, error, blocages: body.blocages ?? [] };
}

export type MembreTrouve =
  | {
      type: 'ADHERENT_TITULAIRE';
      id: string;
      nom: string;
      prenom: string;
      statut: string;
      numeroCarte: string;
      numeroAdherent: string;
    }
  | {
      type: 'BENEFICIAIRE';
      id: string;
      nom: string;
      prenom: string;
      statut: string;
      numeroCarte: string;
      lienParente: string;
      adherent: { id: string; nom: string; prenom: string; statut: string };
    };

/**
 * ADDITIF au code de consultation (ne le remplace pas) — purement informatif :
 * n'ouvre aucun dossier, ne crée rien. Réservé à CENTRE_MEDICAL_ACCUEIL côté
 * API (l'API reste seule juge, ce formulaire n'est masqué que visuellement
 * pour les autres rôles).
 */
export async function rechercherParNumeroCarte(
  numeroCarte: string,
): Promise<{ ok: true; membre: MembreTrouve } | { ok: false; error: string }> {
  const res = await apiFetch(
    `/api/v1/member/recherche-carte?numeroCarte=${encodeURIComponent(numeroCarte)}`,
  );
  if (res.ok) {
    return { ok: true, membre: (await res.json()) as MembreTrouve };
  }
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  const error = Array.isArray(body.message)
    ? body.message.join(' ')
    : (body.message ?? `Erreur ${res.status}`);
  return { ok: false, error };
}

// --- Parcours d'accueil : fiche de la carte, type d'acte, code de confirmation ---------

export type MentionCarte =
  | 'ACTIVE'
  | 'SUSPENDUE'
  | 'RADIÉE'
  | 'SORTIE EN COURS'
  | 'POLICE NON ACTIVE'
  | 'PÉRIMÈTRE NON ACTIF';

export interface ContactAccueil {
  canal: 'EMAIL' | 'SMS';
  masque: string;
  actif: boolean;
  avertissement: string | null;
}

export interface FicheCarte {
  type: 'ADHERENT_TITULAIRE' | 'BENEFICIAIRE';
  nom: string;
  prenom: string;
  numeroCarte: string;
  dateNaissance: string;
  sexe: string | null;
  lien: string;
  photoUrl: string | null;
  societe: string;
  souscripteur: { nom: string; type: string };
  police: { numero: string } | null;
  produit: string | null;
  carte: { mention: MentionCarte; active: boolean; motifs: string[] };
  contacts: { source: 'MEMBRE' | 'TITULAIRE'; liste: ContactAccueil[] };
}

export interface TypeActeAccueil {
  code: string;
  libelle: string;
}

export interface CodeEmisAccueil {
  id: string;
  statut: 'ENVOYE' | 'NON_ENVOYE_DESACTIVE' | 'ECHEC';
  canal: 'EMAIL' | 'SMS';
  destinataire: string;
  typeActe: string;
  etablissement: string | null;
  message: string;
}

async function erreurApi(res: Response): Promise<{ error: string; blocages: string[] }> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[]; blocages?: string[] };
  const error = Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? `Erreur ${res.status}`);
  return { error, blocages: body.blocages ?? [] };
}

/** Fiche d'accueil (consultation journalisée côté API, limitée à l'organisation de l'assureur de l'établissement). */
export async function fichePourAccueil(
  numeroCarte: string,
): Promise<{ ok: true; fiche: FicheCarte; types: TypeActeAccueil[] } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/accueil/carte?numeroCarte=${encodeURIComponent(numeroCarte)}`);
  if (!res.ok) return { ok: false, error: (await erreurApi(res)).error };
  const fiche = (await res.json()) as FicheCarte;
  let types: TypeActeAccueil[] = [];
  if (fiche.carte.active) {
    const t = await apiFetch('/api/v1/accueil/types-acte');
    if (t.ok) types = (await t.json()) as TypeActeAccueil[];
  }
  return { ok: true, fiche, types };
}

/** Le choix du type d'acte déclenche l'envoi du code au contact ENREGISTRÉ du canal choisi (aucune adresse n'est saisie ici). */
export async function emettreCodeAccueil(input: {
  numeroCarte: string;
  categorieActe: string;
  canal: 'EMAIL' | 'SMS';
}): Promise<{ ok: true; code: CodeEmisAccueil } | { ok: false; error: string; blocages: string[] }> {
  const res = await apiFetch('/api/v1/accueil/codes-consultation', { method: 'POST', body: JSON.stringify(input) });
  if (!res.ok) return { ok: false, ...(await erreurApi(res)) };
  return { ok: true, code: (await res.json()) as CodeEmisAccueil };
}
