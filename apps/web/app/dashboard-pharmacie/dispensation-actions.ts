'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';
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

/** Réservée au pharmacien côté API (403 sinon) — voir `PharmacyService.definirPrixStock`. */
export async function definirPrixStock(
  input: { denominationMedicament: string; prixPharmacie?: number; disponible?: boolean },
  cible: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/pharmacy/stock', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Tarif enregistré.' };
}

/**
 * Liste des dispensations de SA pharmacie — corrige l'incohérence relevée à
 * l'audit : le pharmacien/comptable lisaient encore l'ancien mécanisme
 * `codes_ordonnance` (PROMPT 19), qui ne reçoit plus d'écriture depuis la
 * révision du flux par ligne. `statut` filtre côté serveur (le comptable ne
 * veut que PAYEE).
 */
export async function listerDispensationsPharmacie(
  statut?: StatutDispensation,
): Promise<DispensationResume[]> {
  const qs = statut ? `?statut=${statut}` : '';
  const res = await apiFetch(`/api/v1/pharmacy/dispensations${qs}`);
  return res.ok ? ((await res.json()) as DispensationResume[]) : [];
}

export async function preparerDispensation(
  ordonnanceId: string,
  lignes: { ligneOrdonnanceId: string }[],
  cible: string,
): Promise<
  ResultatSoumission & {
    dispensationId?: string;
    montantTotal?: string;
    montantAssurance?: string;
    montantPatient?: string;
  }
> {
  const res = await apiFetch('/api/v1/pharmacy/dispensations', {
    method: 'POST',
    body: JSON.stringify({ ordonnanceId, lignes }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  const body = (await res.json()) as {
    dispensationId: string;
    montantTotal: string;
    montantAssurance: string;
    montantPatient: string;
    message: string;
  };
  revalidatePath(cible);
  return {
    ok: true,
    message: body.message,
    dispensationId: body.dispensationId,
    montantTotal: body.montantTotal,
    montantAssurance: body.montantAssurance,
    montantPatient: body.montantPatient,
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
  input: { nouveauMedicament: string; motif: string },
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
