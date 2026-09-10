'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, messageErreur } from '@/lib/api';

/**
 * Génère la facture d'un ticket de soins CLÔTURÉ. Montants calculés côté serveur
 * depuis les actes + garanties ; le code de facturation part vers l'adhérent
 * (jamais l'établissement).
 */
export async function genererFacture(
  dossierId: string,
  ticketSoinsId: string,
): Promise<
  | { ok: true; montantTotal: string; montantPatient: string }
  | { ok: false; error: string }
> {
  const res = await apiFetch(
    `/api/v1/preauthorization/tickets-soins/${ticketSoinsId}/facture`,
    { method: 'POST' },
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const body = (await res.json()) as {
    montantTotal: string;
    montantPatient: string;
  };
  revalidatePath(`/dashboard-centre-medical/comptable/${dossierId}`);
  revalidatePath('/dashboard-centre-medical/comptable');
  return {
    ok: true,
    montantTotal: body.montantTotal,
    montantPatient: body.montantPatient,
  };
}
