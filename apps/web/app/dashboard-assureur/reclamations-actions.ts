'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, messageErreur } from '@/lib/api';

/**
 * Traitement manuel d'une réclamation `REVUE_MANUELLE`. L'API gère l'autorisation
 * (rôle selon le type) et la machine à états ; ici on relaie seulement.
 */
export async function validerReclamationManuellement(
  reclamationId: string,
  input: {
    decision: 'APPROUVE' | 'REJETE';
    montantAjuste?: number;
    motif: string;
  },
): Promise<
  | { ok: true; statut: string }
  | { ok: false; error: string }
> {
  const body: Record<string, unknown> = {
    decision: input.decision,
    motif: input.motif,
  };
  if (input.montantAjuste !== undefined) body.montantAjuste = input.montantAjuste;

  const res = await apiFetch(
    `/api/v1/claims/reclamations/${reclamationId}/valider-manuellement`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const r = (await res.json()) as { statut: string };
  revalidatePath('/dashboard-assureur/informatique/reclamations');
  revalidatePath('/dashboard-assureur/informatique/reclamations/revue-manuelle');
  revalidatePath(`/dashboard-assureur/informatique/reclamations/${reclamationId}`);
  revalidatePath('/dashboard-assureur/medecin-conseil/reclamations-revue');
  return { ok: true, statut: r.statut };
}
