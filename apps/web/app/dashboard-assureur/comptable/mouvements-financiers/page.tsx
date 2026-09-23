import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import type { CompteFinancier } from '@/components/dashboard/comptes-financiers-ecran';
import {
  MouvementsFinanciersEcran,
  type MouvementFinancier,
} from '@/components/dashboard/mouvements-financiers-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Mouvements & dépenses — Comptable' };

const CIBLE = '/dashboard-assureur/comptable/mouvements-financiers';

export default async function MouvementsFinanciersPage() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const [resMouvements, resComptes] = await Promise.all([
    apiFetch('/api/v1/payment/mouvements'),
    apiFetch('/api/v1/payment/comptes-financiers'),
  ]);
  const mouvements: MouvementFinancier[] = resMouvements.ok ? await resMouvements.json() : [];
  const comptes: CompteFinancier[] = resComptes.ok ? await resComptes.json() : [];
  const erreur = !resMouvements.ok
    ? await messageErreur(resMouvements)
    : !resComptes.ok
      ? await messageErreur(resComptes)
      : null;

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Mouvements & dépenses"
        description="Transferts entre comptes financiers et dépenses courantes de l'assureur. Réservé exclusivement à ASSUREUR_COMPTABLE."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <MouvementsFinanciersEcran mouvements={mouvements} comptes={comptes} />
      )}
    </div>
  );
}
