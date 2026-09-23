'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

/**
 * Partagée entre `/dashboard-assureur/comptable/paiements` et
 * `/dashboard-assureur/comptable-adjoint/paiements` (droits identiques côté
 * API) — `cible` en paramètre, même convention que les autres actions
 * comptable de ce dossier.
 */

const ROUTE_PAR_TYPE = {
  ETABLISSEMENT: '/api/v1/preauthorization/factures-mensuelles-etablissement',
  PHARMACIE: '/api/v1/pharmacy/factures-mensuelles',
} as const;

export async function decocherLigneContestee(
  beneficiaireType: 'ETABLISSEMENT' | 'PHARMACIE',
  factureMensuelleId: string,
  ligneId: string,
  cible: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch(
    `${ROUTE_PAR_TYPE[beneficiaireType]}/${factureMensuelleId}/lignes/${ligneId}/decocher`,
    { method: 'POST' },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Ligne retirée — reportée au mois suivant.' };
}

export async function validerPourPaiementGlobal(
  beneficiaireType: 'ETABLISSEMENT' | 'PHARMACIE',
  factureMensuelleId: string,
  cible: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch(`${ROUTE_PAR_TYPE[beneficiaireType]}/${factureMensuelleId}/valider-pour-paiement`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Facture validée pour paiement.' };
}

export async function associerFacturesPourPaiement(
  beneficiaireType: 'ETABLISSEMENT' | 'PHARMACIE',
  factureMensuelleIds: string[],
  cible: string,
): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/payment/paiements-groupes', {
    method: 'POST',
    body: JSON.stringify({ beneficiaireType, factureMensuelleIds }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: `${factureMensuelleIds.length} facture(s) regroupée(s) en un paiement.` };
}

export async function marquerPaiementGroupePaye(paiementGroupeId: string, cible: string): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/payment/paiements-groupes/${paiementGroupeId}/marquer-paye`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(cible);
  return { ok: true, message: 'Paiement groupé marqué payé.' };
}

export interface LigneFactureDetail {
  id: string;
  libelle: string;
  patient: string;
  numeroTraitement: string;
  montant: string;
  enLitige: boolean;
}

/** Détail ligne-par-ligne à la demande (clic « Détail ») — jamais pré-chargé
 * pour toutes les factures du tableau global, potentiellement nombreuses. */
export async function obtenirDetailFacture(
  beneficiaireType: 'ETABLISSEMENT' | 'PHARMACIE',
  factureMensuelleId: string,
): Promise<LigneFactureDetail[] | null> {
  const res = await apiFetch(`${ROUTE_PAR_TYPE[beneficiaireType]}/${factureMensuelleId}`);
  if (!res.ok) return null;
  const corps = await res.json();
  const lignes: any[] = corps.lignes ?? [];
  return lignes.map((l) =>
    beneficiaireType === 'ETABLISSEMENT'
      ? {
          id: l.id,
          libelle: l.libelle,
          patient: l.patient,
          numeroTraitement: l.numeroTraitement,
          montant: l.montantReclame,
          enLitige: l.enLitige,
        }
      : {
          id: l.id,
          libelle: l.denominationMedicament,
          patient: '—',
          numeroTraitement: '',
          montant: l.montantAssurance,
          enLitige: l.enLitige,
        },
  );
}
