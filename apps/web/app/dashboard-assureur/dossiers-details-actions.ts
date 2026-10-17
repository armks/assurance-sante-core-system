'use server';

import { apiFetch } from '@/lib/api';

export interface DetailsDossier {
  actes: unknown[];
  consultations: unknown[];
  ordonnances: unknown[];
}

/** Actes, consultations et ordonnances d'un dossier, chargés à l'ouverture de sa ligne dans les listes allégées. */
export async function chargerDetailsDossier(id: string): Promise<DetailsDossier | null> {
  const res = await apiFetch(`/api/v1/care-episode/dossiers/${id}/details`);
  return res.ok ? ((await res.json()) as DetailsDossier) : null;
}
