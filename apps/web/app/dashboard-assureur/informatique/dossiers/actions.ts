'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

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

/**
 * Note libre sur un dossier (ou un acte précis) — réservée à
 * ASSUREUR_EXPLOITATION/ASSUREUR_MEDECIN_CONSEIL côté API.
 */
export async function ajouterNote(
  dossierId: string,
  input: { contenu: string; acteDossierId?: string },
): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  );
  const res = await apiFetch(`/api/v1/care-episode/dossiers/${dossierId}/notes`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(`${CIBLE}/${dossierId}`);
  return { ok: true, message: 'Note ajoutée.' };
}
