import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  FacturesMensuellesEcran,
  type FactureMensuelle,
} from '@/components/dashboard/pharmacie/factures-mensuelles-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Factures mensuelles — Comptable' };

const CIBLE = '/dashboard-pharmacie/comptable/factures-mensuelles';

export default async function ComptablePharmacieFacturesMensuellesPage() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch('/api/v1/pharmacy/factures-mensuelles/mes-factures');
  const factures: FactureMensuelle[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Factures mensuelles"
        description="Consolidation mensuelle du montant dû par l’assureur pour vos dispensations payées."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <FacturesMensuellesEcran factures={factures} cible={CIBLE} />
      )}
    </div>
  );
}
