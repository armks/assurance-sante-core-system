'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, messageErreur } from '@/lib/api';

const CIBLE = '/superadmin/societes';

export type ResultatInitiation =
  | { ok: true; actionId: string; message: string; expireLe: string }
  | { ok: false; error: string };

export type ResultatConfirmation =
  | { ok: true; message: string }
  | { ok: false; error: string };

async function initier(path: string, body: unknown): Promise<ResultatInitiation> {
  const res = await apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const b = (await res.json()) as {
    actionId: string;
    emailEnvoye: boolean;
    dateExpiration: string;
    message: string;
  };
  return {
    ok: true,
    actionId: b.actionId,
    expireLe: b.dateExpiration,
    message: b.emailEnvoye
      ? 'Un code de confirmation a été envoyé à l’adresse du superadministrateur.'
      : 'Action enregistrée, mais l’e-mail n’a pas pu être envoyé — vérifiez la configuration Resend.',
  };
}

/** Étape 1 — création d'une organisation + premier compte (envoie le code). */
export async function initierCreationOrganisation(input: {
  nom: string;
  type: 'ASSUREUR' | 'MUTUELLE';
  pays: string;
  devise: string;
  plan: 'STARTER' | 'BUSINESS' | 'ENTERPRISE';
  premierCompteEmail: string;
  premierCompteRole: 'ASSUREUR_DIRECTION' | 'ASSUREUR_INFORMATIQUE';
}): Promise<ResultatInitiation> {
  return initier('/api/v1/superadmin/organisations/initier', input);
}

/** Étape 1 — suspension d'une organisation (envoie le code). */
export async function initierSuspension(
  organisationId: string,
  motif?: string,
): Promise<ResultatInitiation> {
  return initier(
    `/api/v1/superadmin/organisations/${organisationId}/suspension/initier`,
    { motif },
  );
}

/** Étape 1 — prolongation de la licence (envoie le code). */
export async function initierProlongation(
  organisationId: string,
  nouvelleDateFin: string,
): Promise<ResultatInitiation> {
  return initier(
    `/api/v1/superadmin/organisations/${organisationId}/prolongation/initier`,
    { nouvelleDateFin },
  );
}

/** Étape 2 — confirmation par le code reçu par e-mail : exécute réellement l'action. */
export async function confirmerAction(
  code: string,
): Promise<ResultatConfirmation> {
  const res = await apiFetch('/api/v1/superadmin/actions/confirmer', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const b = (await res.json()) as {
    organisation?: { nom?: string };
    invitation?: { erreur?: string; email?: string };
    licence?: { dateFin?: string };
  };
  revalidatePath(CIBLE);
  if (b.organisation) {
    const suite = b.invitation?.erreur
      ? ` ⚠️ ${b.invitation.erreur}`
      : b.invitation?.email
        ? ` Invitation envoyée à ${b.invitation.email}.`
        : '';
    return {
      ok: true,
      message: `Organisation « ${b.organisation.nom ?? ''} » créée.${suite}`,
    };
  }
  if (b.licence) {
    return { ok: true, message: 'Licence prolongée.' };
  }
  return { ok: true, message: 'Action confirmée.' };
}
