'use server';

import { revalidatePath } from 'next/cache';

import type { PageServeur, ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';
import { PAGE_VIDE } from '@/lib/liste-serveur';
import type {
  DispensationDetail,
  DispensationResume,
  LigneStock,
  RecherchePrescriptionsResultat,
  StatutDispensation,
} from './dispensation-types';

/**
 * Actions du vrai parcours de dispensation (module `pharmacy/`, verrou par
 * ligne). `rechercherParCarte`/`obtenirStock`/`obtenirDispensation` sont des
 * lectures, ouvertes aux 3 rôles PHARMACIE (vérifié côté API — la caissière
 * ne peut lire le stock que depuis cette clarification métier, jamais
 * l'écrire). `substituerMedicament` reste réservée au pharmacien côté API :
 * un appel par la caissière échoue en 403, quel que soit ce que montre l'UI.
 */

export async function rechercherParCarte(
  numeroCarte: string,
): Promise<{ ok: true; resultat: RecherchePrescriptionsResultat } | { ok: false; error: string }> {
  const res = await apiFetch(
    `/api/v1/pharmacy/prescriptions/rechercher-par-carte?numeroCarte=${encodeURIComponent(numeroCarte)}`,
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  return { ok: true, resultat: (await res.json()) as RecherchePrescriptionsResultat };
}

export async function obtenirStock(): Promise<LigneStock[]> {
  const res = await apiFetch('/api/v1/pharmacy/stock');
  return res.ok ? ((await res.json()) as LigneStock[]) : [];
}

/** Supprime définitivement une facture annulée (refusé par l'API si elle a été facturée et servie). */
export async function supprimerDispensationAnnulee(dispensationId: string, cible: string): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/pharmacy/dispensations/${dispensationId}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Facture supprimée définitivement.' };
}

/** Saisie, par la pharmacie, du code communiqué par le patient (équivaut à sa validation dans son application). */
export async function validerCodeParPharmacie(dispensationId: string, code: string, cible: string): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/pharmacy/dispensations/${dispensationId}/valider-code-pharmacie`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Code validé : le paiement peut être confirmé.' };
}

/** Supprime (annule) une facture d'ordonnance non réglée de la pharmacie. */
export async function annulerDispensation(dispensationId: string, cible: string): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/pharmacy/dispensations/${dispensationId}/annuler`, { method: 'POST' });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Facture supprimée.' };
}

/** Réservée au pharmacien côté API (403 sinon) — voir `PharmacyService.definirPrixStock`. */
export async function definirPrixStock(
  input: { medicamentId?: string; denominationMedicament?: string; disponible?: boolean },
  cible: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/pharmacy/stock', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Disponibilité enregistrée.' };
}

/**
 * Liste des dispensations de SA pharmacie — corrige l'incohérence relevée à
 * l'audit : le pharmacien/comptable lisaient encore l'ancien mécanisme
 * `codes_ordonnance` (PROMPT 19), qui ne reçoit plus d'écriture depuis la
 * révision du flux par ligne. `statut` filtre côté serveur (le comptable ne
 * veut que PAYEE).
 */
/**
 * Page de dispensations (pagination, recherche, statut, période CÔTÉ SERVEUR —
 * l'API s'arrêtait aux 100 plus récentes). `filtres` : chaîne `?…` issue de
 * l'URL ; `statutImpose` (comptable : PAYEE) l'emporte toujours.
 */
export async function listerDispensationsPharmacie(
  filtres = '',
  statutImpose?: StatutDispensation,
): Promise<PageServeur<DispensationResume>> {
  const p = new URLSearchParams(filtres.startsWith('?') ? filtres.slice(1) : filtres);
  if (statutImpose) p.set('statut', statutImpose);
  const qs = p.toString();
  const res = await apiFetch(`/api/v1/pharmacy/dispensations${qs ? `?${qs}` : ''}`);
  return res.ok ? ((await res.json()) as PageServeur<DispensationResume>) : PAGE_VIDE;
}

export async function preparerDispensation(
  ordonnanceId: string,
  lignes: { ligneOrdonnanceId: string; prixUnitaire: number }[],
  cible: string,
  canal?: 'EMAIL' | 'SMS',
): Promise<
  ResultatSoumission & {
    pharmacieCouverte?: boolean;
    alertes?: { medicament: string; prixUnitaire: string; prixReference: string; majorationPourcent: string }[];
    dispensationId?: string;
    montantTotal?: string;
    montantAssurance?: string;
    montantPatient?: string;
  }
> {
  const res = await apiFetch('/api/v1/pharmacy/dispensations', {
    method: 'POST',
    body: JSON.stringify({ ordonnanceId, lignes, canal }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const body = (await res.json()) as {
    dispensationId: string;
    montantTotal: string;
    montantAssurance: string;
    montantPatient: string;
    alertes: { medicament: string; prixUnitaire: string; prixReference: string; majorationPourcent: string }[];
    pharmacieCouverte: boolean;
    message: string;
  };
  revalidatePath(cible);
  return {
    ok: true,
    message: body.message,
    dispensationId: body.dispensationId,
    pharmacieCouverte: body.pharmacieCouverte,
    montantTotal: body.montantTotal,
    montantAssurance: body.montantAssurance,
    montantPatient: body.montantPatient,
    alertes: body.alertes,
  };
}

export async function obtenirDispensation(dispensationId: string): Promise<DispensationDetail | null> {
  const res = await apiFetch(`/api/v1/pharmacy/dispensations/${dispensationId}`);
  return res.ok ? ((await res.json()) as DispensationDetail) : null;
}

export async function confirmerPaiementDispensation(
  dispensationId: string,
  cible: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/pharmacy/dispensations/${dispensationId}/confirmer-paiement`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const body = (await res.json()) as { montantPatient: string; reclamation: { id: string; statut: string } | null };
  revalidatePath(cible);
  return {
    ok: true,
    message:
      `Paiement confirmé (${Number(body.montantPatient).toLocaleString('fr-FR')} F perçus) — ligne(s) verrouillée(s) pour votre pharmacie.` +
      (body.reclamation
        ? ` Réclamation soumise à l'adjudication (${body.reclamation.statut}).`
        : ''),
  };
}

/** Réservée au pharmacien côté API (403 sinon) — voir `PharmacyService.substituerMedicament`. */
export async function substituerMedicament(
  ligneDispensationId: string,
  input: { nouveauMedicamentId: string; motif: string },
  cible: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/pharmacy/dispensations/lignes/${ligneDispensationId}/substituer`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Substitution enregistrée.' };
}

export interface MedicamentBase {
  id: string;
  denominationCommune: string;
  nomCommercial: string | null;
  dosage: string | null;
  forme: string | null;
}

/** Recherche d'un médicament dans la base (catalogue activé par l'assureur) — le pharmacien le CHOISIT, il ne le saisit pas. */
export async function rechercherMedicamentsBase(q: string): Promise<MedicamentBase[]> {
  const terme = q.trim();
  if (terme.length < 2) return [];
  const res = await apiFetch(`/api/v1/pharmacy/medicaments/recherche?q=${encodeURIComponent(terme)}`);
  return res.ok ? ((await res.json()) as MedicamentBase[]) : [];
}
