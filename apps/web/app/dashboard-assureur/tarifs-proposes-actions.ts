'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatAction } from '@/components/dashboard/patterns';
import { apiFetch, messageErreur } from '@/lib/api';

const CIBLE = '/dashboard-assureur/medecin-conseil/tarifs-proposes';

type TypeAjout = 'FORFAIT' | 'VALEUR_LETTRE_CLE';

async function poster(chemin: string, corps: Record<string, unknown>): Promise<ResultatAction & { alerte?: string }> {
  const res = await apiFetch(`/api/v1/tarifs-proposes/${chemin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const r = await res.json().catch(() => null);
  revalidatePath(CIBLE);
  return { ok: true, alerte: r?.alertePlafond?.message ?? undefined };
}

/** Valide le tarif proposé ; `ajouterConvention` ouvre une exception dans une nouvelle version PROPOSEE. */
export async function validerTarifPropose(id: string, ajouterConvention?: TypeAjout) {
  return poster(`${id}/valider`, ajouterConvention ? { ajouterConvention: { type: ajouterConvention } } : {});
}

/** Ajuste le montant (montant et motif obligatoires). */
export async function ajusterTarifPropose(id: string, montantDecide: number, motif: string, ajouterConvention?: TypeAjout) {
  return poster(`${id}/ajuster`, { montantDecide, motif, ...(ajouterConvention ? { ajouterConvention: { type: ajouterConvention } } : {}) });
}

/** Refuse (motif obligatoire) : l'acte reste non tarifable, l'établissement est prévenu. */
export async function refuserTarifPropose(id: string, motif: string) {
  return poster(`${id}/refuser`, { motif });
}

/** Rappel J+2 et escalade J+5, déclenchés à la main. */
export async function envoyerRappelsTarifs(): Promise<{ ok: true; rappels: number; escalades: number } | { ok: false; error: string }> {
  const res = await apiFetch('/api/v1/tarifs-proposes/rappels', { method: 'POST' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const r = await res.json();
  revalidatePath(CIBLE);
  return { ok: true, rappels: r.rappels, escalades: r.escalades };
}
