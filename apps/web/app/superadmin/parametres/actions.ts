'use server';

import { revalidatePath } from 'next/cache';

import type { ResultatSoumission } from '@/components/dashboard/patterns';
import { apiFetch, detailErreur } from '@/lib/api';

const CIBLE = '/superadmin/parametres';

/** Met à jour (ou crée) un paramètre plateforme — `valeurJson` est parsé ici. */
export async function definirParametre(
  cle: string,
  valeurJson: string,
  description?: string,
): Promise<ResultatSoumission> {
  let valeur: unknown;
  try {
    valeur = JSON.parse(valeurJson);
  } catch {
    return {
      ok: false,
      error: 'La valeur n’est pas un JSON valide.',
      erreurs: ['Vérifiez la syntaxe (guillemets doubles, virgules, crochets…).'],
    };
  }
  const res = await apiFetch(
    `/api/v1/superadmin/config/parametres/${encodeURIComponent(cle)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        valeur,
        ...(description !== undefined && description !== ''
          ? { description }
          : {}),
      }),
    },
  );
  if (!res.ok) return { ok: false, ...(await detailErreur(res)) };
  revalidatePath(CIBLE);
  return { ok: true, message: `Paramètre « ${cle} » enregistré.` };
}
