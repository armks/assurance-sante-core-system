'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, messageErreur } from '@/lib/api';

export type ResultatInvitation =
  | { ok: true; message: string }
  | { ok: false; error: string };

const CIBLE = '/dashboard-assureur/informatique/utilisateurs';

/** Invite un compte dans l'organisation de l'utilisateur connecté. */
export async function inviterUtilisateur(input: {
  email: string;
  rolePropose: string;
  etablissementId?: string;
  pharmacieId?: string;
  societeId?: string;
}): Promise<ResultatInvitation> {
  const res = await apiFetch('/api/v1/invitations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    return { ok: false, error: await messageErreur(res) };
  }
  const inv = (await res.json()) as {
    email: string;
    statut: string;
    emailEnvoye?: boolean;
    lienAcceptation?: string;
  };
  revalidatePath(CIBLE);

  if (inv.statut === 'EN_ATTENTE_VALIDATION_INFORMATIQUE') {
    return {
      ok: true,
      message: `Proposition enregistrée pour ${inv.email} — en attente de validation.`,
    };
  }
  if (inv.emailEnvoye === false) {
    return { ok: false, error: echecEnvoi(`Invitation créée pour ${inv.email}`) };
  }
  return {
    ok: true,
    message: `Invitation envoyée à ${inv.email}. Un e-mail d’invitation a été envoyé.`,
  };
}

/** L'action a abouti mais l'e-mail n'est pas parti : affiché comme une erreur. */
function echecEnvoi(prefixe: string): string {
  return `${prefixe}, mais l’e-mail d’invitation n’a pas pu être envoyé. Utilisez « Renvoyer l’email » ou « Copier le lien » dans « Invitations en cours ».`;
}

/** Valide une proposition en attente (rôle validateur). */
export async function validerProposition(
  id: string,
): Promise<ResultatInvitation> {
  const res = await apiFetch(`/api/v1/invitations/${id}/valider`, {
    method: 'POST',
  });
  if (!res.ok) {
    return { ok: false, error: await messageErreur(res) };
  }
  const inv = (await res.json()) as { email: string; emailEnvoye?: boolean | null };
  revalidatePath(CIBLE);
  if (inv.emailEnvoye === false) {
    return { ok: false, error: echecEnvoi(`Proposition validée pour ${inv.email}`) };
  }
  return { ok: true, message: 'Proposition validée — invitation envoyée.' };
}

/**
 * Rejette une proposition de compte en attente de validation informatique.
 * L'API n'accepte cette action que pour le statut
 * `EN_ATTENTE_VALIDATION_INFORMATIQUE` (une invitation déjà envoyée se « Révoque »).
 */
export async function rejeterInvitation(
  id: string,
  motif?: string,
): Promise<ResultatInvitation> {
  const corps = motif && motif.trim() ? { motif: motif.trim() } : {};
  const res = await apiFetch(`/api/v1/invitations/${id}/rejeter`, {
    method: 'POST',
    body: JSON.stringify(corps),
  });
  if (!res.ok) {
    return { ok: false, error: await messageErreur(res) };
  }
  revalidatePath(CIBLE);
  return { ok: true, message: 'Proposition rejetée.' };
}

/** Révoque une invitation encore ouverte. */
export async function revoquerInvitation(
  id: string,
): Promise<ResultatInvitation> {
  const res = await apiFetch(`/api/v1/invitations/${id}/revoquer`, {
    method: 'POST',
  });
  if (!res.ok) {
    return { ok: false, error: await messageErreur(res) };
  }
  revalidatePath(CIBLE);
  return { ok: true, message: 'Invitation révoquée.' };
}

/**
 * Retente l'envoi réel de l'e-mail d'invitation. Un seul essai — l'échec
 * (ex. limite Supabase atteinte) est renvoyé explicitement, jamais masqué
 * en succès.
 */
export async function renvoyerEmail(id: string): Promise<ResultatInvitation> {
  const res = await apiFetch(`/api/v1/invitations/${id}/renvoyer`, {
    method: 'POST',
  });
  if (!res.ok) {
    return { ok: false, error: await messageErreur(res) };
  }
  const inv = (await res.json()) as { emailEnvoye?: boolean | null };
  revalidatePath(CIBLE);
  if (!inv.emailEnvoye) {
    return {
      ok: false,
      error:
        "Nouvel échec de l'envoi. Utilisez « Copier le lien » pour le transmettre manuellement.",
    };
  }
  return { ok: true, message: 'E-mail renvoyé avec succès.' };
}

/**
 * Rétablit un compte désactivé par un archivage (informatique). Refusé tant que sa structure
 * est archivée : le désarchivage ne réactive jamais les comptes à sa place (ADR-007).
 */
export async function reactiverCompte(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/identity/comptes/${id}/reactiver`, { method: 'POST' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  return { ok: true };
}
