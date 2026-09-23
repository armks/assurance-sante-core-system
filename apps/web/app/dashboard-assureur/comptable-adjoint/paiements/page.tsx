import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  SuiviPaiementsEcran,
  type FactureGlobale,
  type PaiementGroupeResume,
} from '@/components/dashboard/suivi-paiements-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Suivi des paiements — Comptable Adjoint' };

const CIBLE = '/dashboard-assureur/comptable-adjoint/paiements';

export default async function ComptableAdjointPaiementsPage() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const [resFactures, resGroupes] = await Promise.all([
    apiFetch('/api/v1/payment/factures-mensuelles'),
    apiFetch('/api/v1/payment/paiements-groupes'),
  ]);
  const factures: FactureGlobale[] = resFactures.ok ? await resFactures.json() : [];
  const groupes: PaiementGroupeResume[] = resGroupes.ok ? await resGroupes.json() : [];
  const erreur = resFactures.ok ? (resGroupes.ok ? null : await messageErreur(resGroupes)) : await messageErreur(resFactures);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Suivi des paiements"
        description="Toutes les factures mensuelles (établissements et pharmacies), filtres multicritères combinables, et diagramme de consommation."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <SuiviPaiementsEcran facturesInitiales={factures} paiementsGroupesInitiaux={groupes} cible={CIBLE} />
      )}
    </div>
  );
}
