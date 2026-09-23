'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

/**
 * Partagée entre `/dashboard-assureur/comptable/facturation-societes` et
 * `/dashboard-assureur/comptable-adjoint/facturation-societes` (droits
 * identiques côté API, `ROLES_GESTION_BILLING`) — `cible` en paramètre, même
 * convention que `paiements-actions.ts`.
 */

export interface AdherentPourFacturation {
  id: string;
  numeroAdherent: string;
  nom: string;
  prenom: string;
  dateNaissance: string;
  age: number;
  dateValidation: string;
  nbBeneficiaires: number;
}

/** `null` = erreur (message affiché séparément par l'écran) — jamais un tableau vide silencieux. */
export async function listerAdherentsPourFacturation(
  souscripteurId: string,
  periode: string,
): Promise<{ ok: true; adherents: AdherentPourFacturation[] } | { ok: false; error: string }> {
  const res = await apiFetch(
    `/api/v1/billing/souscripteurs/${souscripteurId}/adherents-facturation?periode=${periode}`,
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  return { ok: true, adherents: await res.json() };
}

export interface ResultatConsolidation {
  ok: true;
  montantDu: string;
  nbAdherentsFactures: number;
  nbAdherentsReportes: number;
}

export async function consoliderFacturationSociete(
  souscripteurId: string,
  periode: string,
  cible: string,
): Promise<ResultatConsolidation | { ok: false; error: string; erreurs: string[] }> {
  const res = await apiFetch(`/api/v1/billing/souscripteurs/${souscripteurId}/consolider-facture`, {
    method: 'POST',
    body: JSON.stringify({ periode }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  const corps = await res.json();
  return {
    ok: true,
    montantDu: corps.montantDu,
    nbAdherentsFactures: corps.nbAdherentsFactures,
    nbAdherentsReportes: corps.nbAdherentsReportes,
  };
}
