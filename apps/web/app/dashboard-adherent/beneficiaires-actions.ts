'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import type { Beneficiaire } from '@/components/dashboard/adherents/types';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

const CIBLE = '/dashboard-adherent/beneficiaires';

type ResultatBeneficiaire = { ok: true; beneficiaire: Beneficiaire } | { ok: false; error: string; erreurs?: string[] };

async function traiter(res: Response): Promise<ResultatBeneficiaire> {
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, beneficiaire: await res.json() };
}

export async function proposerMonBeneficiaire(
  adherentId: string,
  input: { lienParente: string; nom: string; prenom: string; dateNaissance: string; sexe: string },
): Promise<ResultatBeneficiaire> {
  const res = await apiFetch(`/api/v1/member/adherents/${adherentId}/beneficiaires/proposition`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return traiter(res);
}

export async function modifierMonBeneficiaire(
  adherentId: string,
  beneficiaireId: string,
  input: { lienParente?: string; nom?: string; prenom?: string; dateNaissance?: string; sexe?: string },
): Promise<ResultatSoumission> {
  const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== ''));
  const res = await apiFetch(`/api/v1/member/adherents/${adherentId}/beneficiaires/${beneficiaireId}/proposition`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Bénéficiaire modifié.' };
}

type ResultatPhoto =
  | { ok: true; url: string; expiresIn: number }
  | { ok: false; error: string };

export async function televerserMaPhoto(adherentId: string, fd: FormData): Promise<ResultatPhoto> {
  const res = await apiFetch(`/api/v1/member/adherents/${adherentId}/photo`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  revalidatePath('/dashboard-adherent/carte');
  return { ok: true, ...(await res.json()) };
}

export async function televerserPhotoBeneficiaire(
  adherentId: string,
  beneficiaireId: string,
  fd: FormData,
): Promise<ResultatPhoto> {
  const res = await apiFetch(`/api/v1/member/adherents/${adherentId}/beneficiaires/${beneficiaireId}/photo`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  return { ok: true, ...(await res.json()) };
}
