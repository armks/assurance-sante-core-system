'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

const CIBLE = '/superadmin/catalogue-national';

/** Cotation d'un acte (prisma/sql/080) : lettre-clé + coefficient, mode isolé / groupé, garantie, groupe. */
export interface CotationActe {
  lettreCleCode?: string | null;
  coefficient?: string | null;
  modeCotation?: string | null;
  categorieGarantie?: string | null;
  groupeCode?: string | null;
}

export async function creerActeNational(input: {
  code: string;
  libelle: string;
  categorie?: string;
  versionNomenclature?: string;
} & CotationActe): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  );
  const res = await apiFetch('/api/v1/superadmin/catalogue-national/actes', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: `Acte « ${input.code} » ajouté au catalogue.` };
}

/** Modifie libellé, chapitre et cotation d'un acte du catalogue national. `null` = effacer la valeur. */
export async function modifierActeNational(
  id: string,
  input: { libelle?: string; categorie?: string | null; versionNomenclature?: string | null } & CotationActe,
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/superadmin/catalogue-national/actes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Acte modifié.' };
}

export async function creerMedicamentNational(input: {
  denominationCommune: string;
  forme?: string;
  dosage?: string;
  classeTherapeutique?: string;
  usage?: string;
}): Promise<ResultatSoumission> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  );
  const res = await apiFetch(
    '/api/v1/superadmin/catalogue-national/medicaments',
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: `« ${input.denominationCommune} » ajouté au catalogue.` };
}

export async function supprimerItemNational(
  type: 'actes' | 'medicaments',
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(
    `/api/v1/superadmin/catalogue-national/${type}/${id}`,
    { method: 'DELETE' },
  );
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  return { ok: true };
}

// --- Import en masse par Excel — réservé EXCLUSIVEMENT SUPERADMIN_PRINCIPAL,
// import ET validation (pas de double validation ici). ---------------------

export interface ImportCatalogueResume {
  id: string;
  type: 'ACTES' | 'MEDICAMENTS';
  fichierNom: string;
  statut: 'EN_ATTENTE_VALIDATION' | 'VALIDE' | 'REJETE';
  nbLignesTotal: number;
  nbLignesValides: number;
  nbLignesErreur: number;
  lignesValides: Record<string, unknown>[];
  erreursDetail: { ligne: number; donnees: Record<string, string>; erreurs: string[] }[];
  createdAt: string;
  dateValidation: string | null;
}

export async function importerCatalogueExcel(
  type: 'actes' | 'medicaments',
  fd: FormData,
): Promise<{ ok: true; import: ImportCatalogueResume } | { ok: false; error: string; erreurs: string[] }> {
  const res = await apiFetch(`/api/v1/superadmin/catalogue-national/${type}/import`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, import: await res.json() };
}

export async function validerImportCatalogue(
  importId: string,
): Promise<{ ok: true; nbCrees: number; nbMisAJour: number } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/superadmin/catalogue-national/imports/${importId}/valider`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  const corps = await res.json();
  return { ok: true, nbCrees: corps.nbCrees, nbMisAJour: corps.nbMisAJour };
}

/** Archivage (retrait) ou désarchivage (réactivation) d'un élément du catalogue national. */
export async function changerStatutItemNational(
  type: 'actes' | 'medicaments',
  id: string,
  action: 'retirer' | 'reactiver',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/superadmin/catalogue-national/${type}/${id}/${action}`, { method: 'POST' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  return { ok: true };
}
