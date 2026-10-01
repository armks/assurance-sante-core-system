'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, messageErreur } from '@/lib/api';

const CIBLE = '/dashboard-assureur/informatique/demandes-adhesion';

/** Passe une demande d'adhésion de NOUVEAU à TRAITE. */
export async function marquerDemandeTraitee(
  id: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/vitrine/demandes-adhesion/${id}/traiter`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Demande marquée traitée.' };
}
