'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, messageErreur } from '@/lib/api';

const ACTES = '/dashboard-assureur/medecin-conseil/actes-a-homologuer';
const MEDICS = '/dashboard-assureur/pharmacien-conseil/medicaments-a-homologuer';

export type ResultatReference =
  | { ok: true; message: string }
  | { ok: false; error: string };

async function poster(
  path: string,
  revalider: string,
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
  revalidatePath(revalider);
  const nom = data.libelle ?? data.denominationCommune ?? '';
  const statut = data.statut ?? data.statutHomologation ?? '';
  return { ok: true, message: `« ${nom} » → ${statut}.` };
}

export async function homologuerActe(id: string) {
  return poster(`/api/v1/reference/actes/${id}/homologuer`, ACTES);
}
export async function suspendreActe(id: string) {
  return poster(`/api/v1/reference/actes/${id}/suspendre`, ACTES, {});
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
export async function reproposerMedicament(id: string) {
  return poster(`/api/v1/reference/medicaments/${id}/reproposer`, MEDICS);
}
