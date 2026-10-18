'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, detailErreur } from '@/lib/api';

const CIBLE = '/superadmin/licences';

export type ResultatLicence =
  | { ok: true; message: string; code?: string }
  | { ok: false; error: string };

/**
 * Génère un code d'activation temporaire (24 h) pour une société. Le code est envoyé par e-mail au superadmin ; il n'est affiché
 * à l'écran que si l'envoi a échoué (repli), une seule fois.
 */
export async function genererCodeActivation(organisationId: string, typeLicence: string): Promise<ResultatLicence> {
  const res = await apiFetch(`/api/v1/superadmin/licences/${organisationId}/code`, { method: 'POST', body: JSON.stringify({ typeLicence }) });
  if (!res.ok) return { ok: false, error: (await detailErreur(res)).error };
  const j = (await res.json()) as { envoyeParEmail: boolean; destinataire: string | null; libelleType: string; expireLe: string; code?: string };
  revalidatePath(CIBLE);
  const expire = new Date(j.expireLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  return j.envoyeParEmail
    ? { ok: true, message: `Code « ${j.libelleType} » envoyé par e-mail à ${j.destinataire}. Valable jusqu’au ${expire} (24 h).` }
    : { ok: true, message: `E-mail non envoyé : voici le code (affiché une seule fois), valable jusqu’au ${expire}. À transmettre à l’administrateur de la société.`, code: j.code };
}

/** Active directement la licence d'une société, sans code. */
export async function activerDirectement(organisationId: string, typeLicence: string): Promise<ResultatLicence> {
  const res = await apiFetch(`/api/v1/superadmin/licences/${organisationId}/activation-directe`, { method: 'POST', body: JSON.stringify({ typeLicence }) });
  if (!res.ok) return { ok: false, error: (await detailErreur(res)).error };
  const j = (await res.json()) as { organisation: string; libelleType: string; dateFin: string | null };
  revalidatePath(CIBLE);
  return { ok: true, message: `${j.organisation} : ${j.libelleType} activée${j.dateFin ? ` jusqu’au ${j.dateFin.split('-').reverse().join('/')}` : ''}.` };
}

/** Envoie l'alerte d'expiration aux administrateurs (informatique et direction) de la société. */
export async function envoyerAlerteExpiration(organisationId: string): Promise<ResultatLicence> {
  const res = await apiFetch(`/api/v1/superadmin/licences/${organisationId}/alerte-expiration`, { method: 'POST' });
  if (!res.ok) return { ok: false, error: (await detailErreur(res)).error };
  const j = (await res.json()) as { organisation: string; destinataires: number; envoye: boolean };
  return j.envoye
    ? { ok: true, message: `Alerte envoyée à ${j.destinataires} administrateur(s) de ${j.organisation}.` }
    : { ok: false, error: 'L’alerte n’a pas pu être envoyée (messagerie non configurée).' };
}
