'use server';

import { apiFetch } from '@/lib/api';

/**
 * Valide le code de consultation présenté par le patient. En cas de succès le
 * dossier de soins est ouvert (numéro de traitement retourné) ; en cas de refus,
 * l'API renvoie la liste PRÉCISE des blocages (moteur d'éligibilité).
 */
export async function validerCodeConsultation(input: {
  code: string;
  motifConsultation: string;
  etablissementId: string;
}): Promise<
  | { ok: true; dossierId: string; numeroTraitement: string }
  | { ok: false; error: string; blocages: string[] }
> {
  const res = await apiFetch(
    '/api/v1/preauthorization/codes-consultation/valider',
    { method: 'POST', body: JSON.stringify(input) },
  );

  if (res.ok) {
    const body = (await res.json()) as {
      dossier: { id: string; numeroTraitement: string };
    };
    return {
      ok: true,
      dossierId: body.dossier.id,
      numeroTraitement: body.dossier.numeroTraitement,
    };
  }

  const body = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    blocages?: string[];
  };
  const error = Array.isArray(body.message)
    ? body.message.join(' ')
    : (body.message ?? `Erreur ${res.status}`);
  return { ok: false, error, blocages: body.blocages ?? [] };
}
