'use server';

import { revalidatePath } from 'next/cache';

import { apiFetch, messageErreur } from '@/lib/api';

/** Les trois écrans qui affichent l'activation du catalogue national (ADR-009). */
const PAGES = [
  '/dashboard-assureur/informatique/referentiel-medical',
  '/dashboard-assureur/medecin-conseil/actes-a-homologuer',
  '/dashboard-assureur/pharmacien-conseil/medicaments-a-homologuer',
];

export type TypeCatalogue = 'actes' | 'medicaments';

export type ResultatActivation =
  | { ok: true; message: string; refuses: { id: string; raison: string }[] }
  | { ok: false; error: string };

async function poster(chemin: string, corps?: unknown): Promise<Response> {
  return apiFetch(`/api/v1/reference/catalogue-national/${chemin}`, {
    method: 'POST',
    ...(corps !== undefined ? { body: JSON.stringify(corps) } : {}),
  });
}

const revalider = () => PAGES.forEach((p) => revalidatePath(p));

/** Active un élément du catalogue national pour l'organisation (informatique, médecin conseil, pharmacien conseil). */
export async function activerElement(type: TypeCatalogue, id: string): Promise<ResultatActivation> {
  const res = await poster(`${type}/${id}/activer`);
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalider();
  return { ok: true, message: 'Élément activé.', refuses: [] };
}

/** Désactive un élément actif (réversible : il n'est plus proposé à la saisie, les données déjà enregistrées sont conservées). */
export async function desactiverElement(type: TypeCatalogue, id: string, motif?: string): Promise<ResultatActivation> {
  const res = await poster(`${type}/${id}/desactiver`, motif ? { motif } : {});
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  revalider();
  return { ok: true, message: 'Élément désactivé.', refuses: [] };
}

/** Activation / désactivation d'une sélection (200 au plus) ou de TOUT le catalogue (`tous`). */
export async function activationMasse(
  type: TypeCatalogue,
  lot: { ids?: string[]; tous?: boolean; actif: boolean },
): Promise<ResultatActivation> {
  const res = await poster(`${type}/activation-masse`, lot);
  if (!res.ok) return { ok: false, error: await messageErreur(res) };
  const r = (await res.json()) as { reussis: number; refuses: { id: string; raison: string }[] };
  revalider();
  const verbe = lot.actif ? 'activé' : 'désactivé';
  return {
    ok: true,
    message: `${r.reussis} élément${r.reussis > 1 ? 's' : ''} ${verbe}${r.reussis > 1 ? 's' : ''}${r.refuses.length ? ` — ${r.refuses.length} refusé${r.refuses.length > 1 ? 's' : ''}` : ''}.`,
    refuses: r.refuses,
  };
}
