'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

/**
 * Réservé EXCLUSIVEMENT à ASSUREUR_COMPTABLE côté API (jamais son adjoint —
 * `ROLES_GESTION_COMPTES_FINANCIERS`, module `payment/`) — pas de `cible` en
 * paramètre ici : contrairement aux autres actions comptable de ce dossier,
 * cet écran n'existe QUE sous `/dashboard-assureur/comptable`, jamais sous
 * `comptable-adjoint`.
 */
const CIBLE = '/dashboard-assureur/comptable/comptes-financiers';

export async function creerCompteFinancier(
  type: 'BANCAIRE' | 'CAISSE_INTERNE',
  nom: string,
  fondsInitial: number,
  banqueNom?: string,
  numeroCompte?: string,
): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries({ type, nom, fondsInitial, banqueNom, numeroCompte }).filter(
      ([, v]) => v !== undefined && v !== '',
    ),
  );
  const res = await apiFetch('/api/v1/payment/comptes-financiers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Compte financier créé.' };
}

export async function approvisionnerCompte(
  compteId: string,
  montant: number,
  source: 'EXTERNE' | 'AUTRE_COMPTE',
  compteSourceId: string | undefined,
  piecesJustificatives: string[],
): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries({ montant, source, compteSourceId, piecesJustificatives }).filter(
      ([, v]) => v !== undefined && v !== '',
    ),
  );
  const res = await apiFetch(`/api/v1/payment/comptes-financiers/${compteId}/approvisionner`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Compte approvisionné.' };
}
