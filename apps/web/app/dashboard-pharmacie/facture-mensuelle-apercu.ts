import type { ApercuFactureMensuelle } from '@/components/dashboard/pharmacie/facture-mensuelle-apercu';
import { apiFetch, messageErreur } from '@/lib/api';

export type MoisApercu = 'precedent' | 'courant';

/** Premier jour (YYYY-MM-01, UTC) du mois précédent (à facturer) ou du mois en cours (aperçu). */
export function periodeApercu(mois: MoisApercu): string {
  const n = new Date();
  const decalage = mois === 'precedent' ? -1 : 0;
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + decalage, 1)).toISOString().slice(0, 10);
}

/** Aperçu de la facture mensuelle avant soumission (API `GET /pharmacy/factures-mensuelles/apercu`). */
export async function chargerApercuFactureMensuelle(
  mois: MoisApercu,
): Promise<{ apercu: ApercuFactureMensuelle | null; erreur: string | null }> {
  const res = await apiFetch(`/api/v1/pharmacy/factures-mensuelles/apercu?periode=${periodeApercu(mois)}`);
  return res.ok ? { apercu: (await res.json()) as ApercuFactureMensuelle, erreur: null } : { apercu: null, erreur: await messageErreur(res) };
}
