'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, detailErreur } from '@/lib/api';
import type { EtablissementRecherche, JourCreneaux, MedecinAgenda, PatientRecherche } from '@/lib/rendez-vous';

type Echec = { ok: false; error: string; erreurs?: string[] };
export type ResultatRdv = { ok: true; message?: string } | Echec;
export type ResultatDonnees<T> = { ok: true; data: T } | Echec;

/** Pages rafraîchies après une écriture (liste blanche : jamais un chemin fourni tel quel par le navigateur). */
const PAGES = [
  '/dashboard-centre-medical/agenda',
  '/dashboard-centre-medical/rendez-vous',
  '/dashboard-assureur/exploitation/rendez-vous',
  '/dashboard-assureur/exploitation-conjointe/rendez-vous',
  '/dashboard-assureur/secretaire/rendez-vous',
  '/dashboard-assureur/secretaire',
  '/dashboard-adherent/rendez-vous',
];
const rafraichir = (page: string) => {
  if (PAGES.includes(page)) revalidatePath(page);
};

async function ecriture(chemin: string, methode: 'POST' | 'DELETE', corps: unknown, page: string, message: string): Promise<ResultatRdv> {
  const res = await apiFetch(`/api/v1/rendez-vous${chemin}`, { method: methode, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  rafraichir(page);
  return { ok: true, message };
}

async function lecture<T>(chemin: string): Promise<ResultatDonnees<T>> {
  const res = await apiFetch(`/api/v1/rendez-vous${chemin}`);
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  return { ok: true, data: (await res.json()) as T };
}

// ---- agenda de présence
export type EntreeRegle = {
  medecinId?: string;
  type: 'DATE' | 'JOUR' | 'ABSENCE';
  date?: string;
  jourSemaine?: number;
  valideDu?: string;
  valideAu?: string;
  heureDebut: string;
  heureFin: string;
  dureeCreneauMin?: number;
};

export async function ajouterRegleAgenda(input: EntreeRegle, page: string): Promise<ResultatRdv> {
  const corps = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== '' && !Number.isNaN(v)));
  return ecriture('/agenda', 'POST', corps, page, 'Disponibilité enregistrée.');
}

export async function supprimerRegleAgenda(id: string, page: string): Promise<ResultatRdv> {
  return ecriture(`/agenda/${encodeURIComponent(id)}`, 'DELETE', undefined, page, 'Disponibilité supprimée.');
}

// ---- recherches (lecture seule)
export async function chargerMedecins(etablissementId?: string): Promise<ResultatDonnees<MedecinAgenda[]>> {
  return lecture<MedecinAgenda[]>(`/medecins${etablissementId ? `?etablissementId=${encodeURIComponent(etablissementId)}` : ''}`);
}

export async function chargerCreneaux(medecinId: string, du: string, au: string, sauf?: string): Promise<ResultatDonnees<JourCreneaux[]>> {
  return lecture<JourCreneaux[]>(`/creneaux?medecinId=${encodeURIComponent(medecinId)}&du=${du}&au=${au}${sauf ? `&sauf=${encodeURIComponent(sauf)}` : ''}`);
}

export async function rechercherPatients(q: string): Promise<ResultatDonnees<PatientRecherche[]>> {
  return lecture<PatientRecherche[]>(`/patients?q=${encodeURIComponent(q)}`);
}

export async function rechercherEtablissements(q: string): Promise<ResultatDonnees<EtablissementRecherche[]>> {
  return lecture<EtablissementRecherche[]>(`/etablissements${q ? `?q=${encodeURIComponent(q)}` : ''}`);
}

// ---- rendez-vous
export async function proposerRendezVous(
  input: { etablissementId: string; medecinId: string; adherentId: string; beneficiaireId?: string; debut: string; motif?: string },
  page: string,
): Promise<ResultatRdv> {
  const corps = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== ''));
  return ecriture('', 'POST', corps, page, 'Rendez-vous proposé à l’établissement.');
}

export async function confirmerRendezVous(id: string, page: string): Promise<ResultatRdv> {
  return ecriture(`/${encodeURIComponent(id)}/confirmer`, 'POST', {}, page, 'Rendez-vous confirmé.');
}

export async function refuserRendezVous(id: string, motif: string, page: string): Promise<ResultatRdv> {
  return ecriture(`/${encodeURIComponent(id)}/refuser`, 'POST', { motif }, page, 'Proposition refusée.');
}

export async function annulerRendezVous(id: string, motif: string, page: string): Promise<ResultatRdv> {
  return ecriture(`/${encodeURIComponent(id)}/annuler`, 'POST', { motif }, page, 'Rendez-vous annulé.');
}

export async function modifierRendezVous(id: string, input: { debut: string; medecinId?: string }, page: string): Promise<ResultatRdv> {
  return ecriture(`/${encodeURIComponent(id)}/modifier`, 'POST', Object.fromEntries(Object.entries(input).filter(([, v]) => v)), page, 'Rendez-vous modifié et confirmé.');
}
