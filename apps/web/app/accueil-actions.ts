'use server';

import { headers } from 'next/headers';

import { apiFetchPublic, messageErreur } from '@/lib/api';

export type ResultatFormulaire =
  | { ok: true; message: string }
  | { ok: false; error: string; erreurs?: string[] };

/**
 * IP du visiteur, transmise à l'API (X-Forwarded-For) : c'est ce serveur
 * Next.js qui appelle NestJS, l'API verrait sinon toujours la même IP et le
 * limiteur de débit par IP ne servirait à rien.
 */
async function enTetesVisiteur(): Promise<HeadersInit> {
  const h = await headers();
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '';
  return ip ? { 'X-Forwarded-For': ip } : {};
}

async function envoyer(chemin: string, corps: Record<string, unknown>): Promise<ResultatFormulaire> {
  try {
    const res = await apiFetchPublic(chemin, {
      method: 'POST',
      body: JSON.stringify(corps),
      headers: await enTetesVisiteur(),
    });
    if (res.ok) {
      const b = (await res.json()) as { message?: string };
      return { ok: true, message: b.message ?? 'Merci, c’est bien reçu.' };
    }
    const brut = res.clone();
    try {
      const b = (await res.json()) as { message?: string | string[] };
      if (Array.isArray(b.message)) {
        return { ok: false, error: 'Merci de corriger les champs indiqués.', erreurs: b.message };
      }
    } catch {
      /* corps non JSON : message générique ci-dessous */
    }
    return { ok: false, error: await messageErreur(brut) };
  } catch {
    return { ok: false, error: 'Le service est momentanément injoignable. Merci de réessayer.' };
  }
}

/** Contact, Devenir partenaire ou Adhésion (champ `type`). */
export async function envoyerDemande(fd: FormData): Promise<ResultatFormulaire> {
  const champ = (n: string) => {
    const v = fd.get(n);
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  const nombre = (n: string) => {
    const v = champ(n);
    return v === undefined ? undefined : Number(v);
  };
  return envoyer('/api/v1/public/demandes', {
    type: champ('type'),
    structure: champ('structure'),
    effectif: nombre('effectif'),
    categorie: champ('categorie'),
    ville: champ('ville'),
    latitude: nombre('latitude'),
    longitude: nombre('longitude'),
    email: champ('email'),
    telephone: champ('telephone'),
    objet: champ('objet'),
    message: champ('message'),
    organisation: champ('organisation'),
    siteWeb: champ('siteWeb'),
  });
}

export async function inscrireNewsletter(fd: FormData): Promise<ResultatFormulaire> {
  const v = (n: string) => (typeof fd.get(n) === 'string' ? String(fd.get(n)).trim() : '');
  return envoyer('/api/v1/public/newsletter', {
    email: v('email'),
    siteWeb: v('siteWeb') || undefined,
  });
}
