'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, messageErreur } from '@/lib/api';

export type ResultatAction =
  | { ok: true; message: string }
  | { ok: false; error: string };

/** Crée une organisation (tenant racine) — superadmin. */
export async function creerOrganisation(input: {
  nom: string;
  type: 'ASSUREUR' | 'MUTUELLE';
  pays: string;
  devise: string;
}): Promise<ResultatAction> {
  const res = await apiFetch('/api/v1/identity/organisations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    return { ok: false, error: await messageErreur(res) };
  }
  const org = (await res.json()) as { nom: string };
  revalidatePath('/superadmin/societes');
  return { ok: true, message: `Organisation « ${org.nom} » créée.` };
}

/** Invite le premier compte d'une organisation (ASSUREUR_DIRECTION ou _INFORMATIQUE). */
export async function inviterPremierCompte(input: {
  organisationId: string;
  email: string;
  rolePropose: 'ASSUREUR_DIRECTION' | 'ASSUREUR_INFORMATIQUE';
}): Promise<ResultatAction> {
  const res = await apiFetch('/api/v1/invitations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    return { ok: false, error: await messageErreur(res) };
  }
  const inv = (await res.json()) as {
    email: string;
    emailEnvoye?: boolean;
    lienAcceptation?: string;
  };
  revalidatePath('/superadmin/societes');
  const suffixe = inv.emailEnvoye
    ? ' Un e-mail d’invitation a été envoyé.'
    : inv.lienAcceptation
      ? ` Lien d’activation : ${inv.lienAcceptation}`
      : '';
  return { ok: true, message: `Invitation envoyée à ${inv.email}.${suffixe}` };
}
