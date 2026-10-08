'use server';

import type { VerdictAction } from '@/components/dashboard/patterns';
import { apiFetch, messageErreur } from '@/lib/api';

/**
 * « Action possible ? » (ADR-007) : verdict du serveur pour une entité du registre des
 * dépendances (`apps/api/src/dependances/registre.ts`). Utilisé par `ConfirmationAction`
 * à l'ouverture ; le serveur refuse de toute façon l'action elle-même (409).
 */
export async function verifierAction(
  entite: string,
  id: string,
  action: 'supprimer' | 'archiver' | 'desarchiver' | 'modifier',
): Promise<VerdictAction | { erreur: string }> {
  const res = await apiFetch(`/api/v1/dependances/${encodeURIComponent(entite)}/${encodeURIComponent(id)}/${action}`);
  if (!res.ok) return { erreur: await messageErreur(res) };
  const v = (await res.json()) as VerdictAction;
  return { possible: v.possible, raison: v.raison, liens: v.liens };
}

export type VerdictsListe = Record<
  string,
  Record<'supprimer' | 'archiver' | 'desarchiver' | 'modifier', { possible: boolean; raison: string | null; code: string | null }>
>;

/** Verdicts des quatre actions pour toute une liste (boutons d'une table) — {} en cas d'erreur. */
export async function verdictsListe(entite: string, ids: string[]): Promise<VerdictsListe> {
  if (ids.length === 0) return {};
  const res = await apiFetch(`/api/v1/dependances/${encodeURIComponent(entite)}/verdicts`, {
    method: 'POST',
    body: JSON.stringify({ ids: ids.slice(0, 200) }),
  });
  return res.ok ? ((await res.json()) as VerdictsListe) : {};
}

/** Le rôle de l'appelant peut-il supprimer définitivement (service informatique) ? */
export async function peutSupprimerDefinitivement(): Promise<boolean> {
  const { exigerIdentite } = await import('@/lib/identity');
  const etat = await exigerIdentite('/dashboard-assureur/informatique');
  const roles = etat.kind === 'ok' ? etat.identity.permissions?.roleChain ?? [] : [];
  return roles.includes('ASSUREUR_INFORMATIQUE');
}
