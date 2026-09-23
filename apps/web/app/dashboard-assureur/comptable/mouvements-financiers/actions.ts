'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

/**
 * Réservé EXCLUSIVEMENT à ASSUREUR_COMPTABLE côté API (jamais son adjoint —
 * même périmètre que `comptes-financiers/actions.ts`) — cet écran n'existe
 * QUE sous `/dashboard-assureur/comptable`, jamais sous `comptable-adjoint`.
 * `fd` porte à la fois les champs texte et le fichier `pieceJointe`
 * (multipart, transmis tel quel à l'API — jamais reconstruit en JSON).
 */
const CIBLE = '/dashboard-assureur/comptable/mouvements-financiers';

export async function transfererEntreComptes(fd: FormData): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/payment/mouvements/transfert', {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Transfert effectué.' };
}

export async function enregistrerDepense(fd: FormData): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/payment/mouvements/depense', {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Dépense enregistrée.' };
}

export async function obtenirUrlPieceJointeMouvement(mouvementId: string): Promise<{ url: string } | null> {
  const res = await apiFetch(`/api/v1/payment/mouvements/${mouvementId}/piece`);
  if (!res.ok) return null;
  return res.json();
}
