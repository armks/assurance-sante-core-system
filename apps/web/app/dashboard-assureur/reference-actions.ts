'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, messageErreur } from '@/lib/api';

const ACTES = '/dashboard-assureur/medecin-conseil/actes-a-homologuer';
const MEDICS = '/dashboard-assureur/pharmacien-conseil/medicaments-a-homologuer';
const REFERENTIEL_INFORMATIQUE = '/dashboard-assureur/informatique/referentiel-medical';

export type ResultatReference =
  | { ok: true; message: string }
  | { ok: false; error: string };

async function poster(
  path: string,
  revalider: string | string[],
  body?: unknown,
): Promise<ResultatReference> {
  const res = await apiFetch(path, {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const data = (await res.json()) as {
    libelle?: string;
    denominationCommune?: string;
    statut?: string;
    statutHomologation?: string;
  };
  for (const p of Array.isArray(revalider) ? revalider : [revalider]) {
    revalidatePath(p);
  }
  const nom = data.libelle ?? data.denominationCommune ?? '';
  const statut = data.statut ?? data.statutHomologation ?? '';
  return { ok: true, message: `« ${nom} » → ${statut}.` };
}

/** Création directe (ASSUREUR_INFORMATIQUE) — pas seulement via import du catalogue national. */
export async function proposerActe(input: {
  code: string;
  libelle: string;
  categorie?: string;
  versionNomenclature?: string;
}): Promise<ResultatReference> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  );
  return poster('/api/v1/reference/actes', [ACTES, REFERENTIEL_INFORMATIQUE], body);
}

/** Création directe (ASSUREUR_INFORMATIQUE) — pas seulement via import du catalogue national. */
export async function proposerMedicament(input: {
  denominationCommune: string;
  nomCommercial?: string;
  codeEan?: string;
  forme?: string;
  dosage?: string;
  conditionnement?: string;
  classeTherapeutique?: string;
}): Promise<ResultatReference> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  );
  return poster(
    '/api/v1/reference/medicaments',
    [MEDICS, REFERENTIEL_INFORMATIQUE],
    body,
  );
}

export async function homologuerActe(id: string) {
  return poster(`/api/v1/reference/actes/${id}/homologuer`, ACTES);
}
export async function suspendreActe(id: string) {
  return poster(`/api/v1/reference/actes/${id}/suspendre`, ACTES, {});
}
/** Retrait — distinct de la suspension (temporaire) : RETIRE, réservé au médecin conseil. */
export async function retirerActe(id: string) {
  return poster(`/api/v1/reference/actes/${id}/retirer`, ACTES, {});
}
export async function reproposerActe(id: string) {
  return poster(`/api/v1/reference/actes/${id}/reproposer`, ACTES);
}

export async function homologuerMedicament(id: string, remboursable: boolean) {
  return poster(`/api/v1/reference/medicaments/${id}/homologuer`, MEDICS, {
    remboursable,
  });
}
export async function suspendreMedicament(id: string) {
  return poster(`/api/v1/reference/medicaments/${id}/suspendre`, MEDICS, {});
}
/** Retrait — distinct de la suspension (temporaire) : RETIRE, réservé au pharmacien conseil. */
export async function retirerMedicament(id: string) {
  return poster(`/api/v1/reference/medicaments/${id}/retirer`, MEDICS, {});
}
export async function reproposerMedicament(id: string) {
  return poster(`/api/v1/reference/medicaments/${id}/reproposer`, MEDICS);
}
