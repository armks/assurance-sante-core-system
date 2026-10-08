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
