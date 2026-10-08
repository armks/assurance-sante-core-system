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

/**
 * Soumet une réclamation pour un acte (écran « Nouvelle réclamation ») : l'API vérifie
 * que l'acte est réclamable, crée la réclamation et la fait adjuger par le microservice.
 * Renvoie l'identifiant de la réclamation pour ouvrir son détail (décision, montant
 * remboursé, codes). `montant` : montant payé par le patient, à défaut celui de l'acte.
 */
export async function soumettreReclamation(
  acteDossierId: string,
  montant?: number,
): Promise<
  | { ok: true; message: string; reclamationId: string }
  | { ok: false; error: string }
> {
  const res = await apiFetch('/api/v1/claims/reclamations/soumettre', {
    method: 'POST',
    body: JSON.stringify({
      acteDossierId,
      ...(montant !== undefined && !Number.isNaN(montant) ? { montant } : {}),
    }),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const r = (await res.json()) as { reclamation: { id: string; statut: string } };
  revalidatePath('/dashboard-assureur/informatique/reclamations');
  revalidatePath('/dashboard-assureur/informatique/reclamations/nouvelle');
  revalidatePath('/dashboard-assureur/informatique/reclamations/revue-manuelle');
  return { ok: true, message: 'Réclamation soumise.', reclamationId: r.reclamation.id };
}
