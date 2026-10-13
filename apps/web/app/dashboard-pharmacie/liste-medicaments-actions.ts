'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur, messageErreur } from '@/lib/api';

const CIBLE = '/dashboard-pharmacie/pharmacien/medicaments';

/**
 * Liste des médicaments remboursables de la pharmacie (catalogue national activé par l'assureur) — écriture réservée au
 * pharmacien côté API (403 sinon). Ces actions ne touchent que la liste de la pharmacie : jamais le catalogue national ni ses tarifs.
 */
export async function ajouterMedicamentAMaListe(nationalId: string): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/pharmacy/medicaments-remboursables/${nationalId}/ajouter`, { method: 'POST' });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Médicament ajouté à votre liste.' };
}

export async function modifierMedicamentDeMaListe(
  nationalId: string,
  input: { disponible?: boolean; note?: string },
): Promise<ResultatSoumission> {
  const res = await apiFetch(`/api/v1/pharmacy/medicaments-remboursables/${nationalId}`, { method: 'PATCH', body: JSON.stringify(input) });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Liste mise à jour.' };
}

/**
 * Ajout d'un NOUVEAU médicament au catalogue national, avec son prix national (pharmacien seul, 403 sinon). Aucun effet financier tant que
 * l'assureur ne l'a pas activé ; un médicament existant n'est jamais modifié.
 */
export async function creerMedicamentCatalogue(input: {
  denominationCommune: string;
  nomCommercial?: string;
  dosage?: string;
  forme?: string;
  classeTherapeutique?: string;
  prixReferenceXof: number;
}): Promise<ResultatSoumission> {
  const res = await apiFetch('/api/v1/pharmacy/catalogue-national/medicaments', { method: 'POST', body: JSON.stringify(input) });
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: 'Médicament ajouté au catalogue national.' };
}

export async function retirerMedicamentDeMaListe(nationalId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/v1/pharmacy/medicaments-remboursables/${nationalId}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalidatePath(CIBLE);
  return { ok: true };
}
