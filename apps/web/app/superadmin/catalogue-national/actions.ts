'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

const CIBLE = '/superadmin/catalogue-national';

export async function creerActeNational(input: {
  code: string;
  libelle: string;
  categorie?: string;
  versionNomenclature?: string;
}): Promise<ResultatSoumission> {
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
