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

export type MembreTrouve =
  | {
      type: 'ADHERENT_TITULAIRE';
      id: string;
      nom: string;
      prenom: string;
      statut: string;
      numeroCarte: string;
      numeroAdherent: string;
    }
  | {
      type: 'BENEFICIAIRE';
      id: string;
      nom: string;
      prenom: string;
      statut: string;
      numeroCarte: string;
      lienParente: string;
      adherent: { id: string; nom: string; prenom: string; statut: string };
    };

/**
 * ADDITIF au code de consultation (ne le remplace pas) — purement informatif :
 * n'ouvre aucun dossier, ne crée rien. Réservé à CENTRE_MEDICAL_ACCUEIL côté
 * API (l'API reste seule juge, ce formulaire n'est masqué que visuellement
 * pour les autres rôles).
 */
export async function rechercherParNumeroCarte(
  numeroCarte: string,
): Promise<{ ok: true; membre: MembreTrouve } | { ok: false; error: string }> {
  const res = await apiFetch(
    `/api/v1/member/recherche-carte?numeroCarte=${encodeURIComponent(numeroCarte)}`,
  );
  if (res.ok) {
    return { ok: true, membre: (await res.json()) as MembreTrouve };
  }
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  const error = Array.isArray(body.message)
    ? body.message.join(' ')
    : (body.message ?? `Erreur ${res.status}`);
  return { ok: false, error };
}
