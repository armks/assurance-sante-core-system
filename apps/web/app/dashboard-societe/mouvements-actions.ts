'use server';

import { revalidatePath } from 'next/cache';

import type { ImportAdherentsResume } from '@/components/dashboard/adherents/types';
import { apiFetch, detailErreur } from '@/lib/api';

const CIBLES = [
  '/dashboard-societe/administration/mouvements',
  '/dashboard-societe/administration/adherents',
];
function revalider() {
  for (const c of CIBLES) revalidatePath(c);
}

// --- Sortants --------------------------------------------------------

export async function proposerSortants(
  souscripteurId: string,
  sortants: { adherentId: string; statutCible: string; motif: string }[],
): Promise<{ ok: true } | { ok: false; error: string; erreurs?: string[] }> {
  const res = await apiFetch('/api/v1/member/sortants/proposer', {
    method: 'POST',
    body: JSON.stringify({ souscripteurId, sortants }),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalider();
  return { ok: true };
}

type ResultatImportSortants =
  | { ok: true; nbProposes: number; erreursDetail: { ligne: number; donnees: Record<string, string>; erreurs: string[] }[] }
  | { ok: false; error: string; erreurs?: string[] };

export async function importerSortantsExcel(
  souscripteurId: string,
  fd: FormData,
): Promise<ResultatImportSortants> {
  const res = await apiFetch(`/api/v1/member/souscripteurs/${souscripteurId}/imports-sortants`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalider();
  return { ok: true, ...(await res.json()) };
}

// --- Entrants (fichier) ------------------------------------------------

type ResultatImportEntrants = { ok: true; import: ImportAdherentsResume } | { ok: false; error: string; erreurs?: string[] };

export async function importerEntrantsExcel(
  souscripteurId: string,
  fd: FormData,
): Promise<ResultatImportEntrants> {
  const res = await apiFetch(`/api/v1/member/souscripteurs/${souscripteurId}/imports-entrants`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalider();
  return { ok: true, import: await res.json() };
}
