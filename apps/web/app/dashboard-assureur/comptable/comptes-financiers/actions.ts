'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

/**
 * Réservé EXCLUSIVEMENT à ASSUREUR_COMPTABLE côté API (jamais son adjoint —
 * `ROLES_GESTION_COMPTES_FINANCIERS`, module `payment/`) — pas de `cible` en
 * paramètre ici : contrairement aux autres actions comptable de ce dossier,
 * cet écran n'existe QUE sous `/dashboard-assureur/comptable`, jamais sous
 * `comptable-adjoint`.
 */
const CIBLE = '/dashboard-assureur/comptable/comptes-financiers';
const CIBLE_INFO = '/dashboard-assureur/informatique/comptes-financiers';
const rafraichir = () => {
  revalidatePath(CIBLE);
  revalidatePath(CIBLE_INFO);
};

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

type ResultatCycle = { ok: true; message?: string } | { ok: false; error: string };

/** Libellé seulement : le solde d'un compte ne se modifie jamais directement. */
export async function modifierCompteFinancier(id: string, nom: string): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/payment/comptes-financiers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ nom }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  rafraichir();
  return { ok: true, message: 'Libellé modifié.' };
}

export async function archiverCompteFinancier(id: string): Promise<ResultatCycle> {
  const res = await apiFetch(`/api/v1/payment/comptes-financiers/${id}/archiver`, { method: 'POST' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  rafraichir();
  return { ok: true, message: 'Compte archivé.' };
}

export async function desarchiverCompteFinancier(id: string): Promise<ResultatCycle> {
  const res = await apiFetch(`/api/v1/payment/comptes-financiers/${id}/desarchiver`, { method: 'POST' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  rafraichir();
  return { ok: true, message: 'Compte désarchivé.' };
}

export async function supprimerCompteFinancier(id: string): Promise<ResultatCycle> {
  const res = await apiFetch(`/api/v1/payment/comptes-financiers/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) return { ok: false, error: await messageErreur(res) };
  rafraichir();
  return { ok: true, message: 'Compte supprimé.' };
}
