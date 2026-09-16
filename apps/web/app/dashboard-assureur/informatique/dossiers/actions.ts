'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, messageErreur } from '@/lib/api';

const CIBLE = '/dashboard-assureur/informatique/dossiers';

/**
 * Clôture forcée d'un dossier de soins — réservée à ASSUREUR_EXPLOITATION
 * côté API (ROLE_CLOTURE_FORCEE), motif obligatoire (min. 5 caractères).
 */
export async function clotureForceeDossier(
  dossierId: string,
  motif: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(
    `/api/v1/care-episode/dossiers/${dossierId}/cloture-forcee`,
    { method: 'POST', body: JSON.stringify({ motif }) },
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(`${CIBLE}/${dossierId}`);
  revalidatePath(CIBLE);
  return { ok: true };
}
