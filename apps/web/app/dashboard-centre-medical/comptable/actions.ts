'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, detailErreur } from '@/lib/api';

/**
 * Génère un cycle de facturation pour les actes sélectionnés (facturation par
 * sélection d'actes, paiement partiel — plusieurs cycles successifs possibles
 * sur le même dossier). Montants calculés côté serveur depuis les actes +
 * garanties ; le code de facturation part vers l'adhérent (jamais
 * l'établissement).
 */
export async function genererFactureSelection(
  dossierId: string,
  acteIds: string[],
): Promise<
  | { ok: true; montantTotal: string; montantPatient: string; message: string }
  | { ok: false; error: string }
> {
  const res = await apiFetch(
    `/api/v1/preauthorization/dossiers/${dossierId}/facture-selection`,
    { method: 'POST', body: JSON.stringify({ acteIds }) },
  );
  if (!res.ok) {
    const { error } = await detailErreur(res);
    return { ok: false, error };
  }
  const body = (await res.json()) as {
    montantTotal: string;
    montantPatient: string;
    message: string;
  };
  revalidatePath(`/dashboard-centre-medical/comptable/${dossierId}`);
  revalidatePath('/dashboard-centre-medical/comptable');
  return {
    ok: true,
    montantTotal: body.montantTotal,
    montantPatient: body.montantPatient,
    message: body.message,
  };
}
