'use server';

import { apiFetch } from '@/lib/api';

export interface MaladieProposee {
  code: string;
  libelle: string;
}

/** Recherche dans le référentiel CIM-10 (maladies actives) par code ou nom — sélecteur du médecin. */
export async function rechercherMaladiesCim10(q: string): Promise<MaladieProposee[]> {
  const terme = q.trim();
  if (terme.length < 2) return [];
  const res = await apiFetch(`/api/v1/cim10?q=${encodeURIComponent(terme)}&limite=15`);
  return res.ok ? await res.json() : [];
}
