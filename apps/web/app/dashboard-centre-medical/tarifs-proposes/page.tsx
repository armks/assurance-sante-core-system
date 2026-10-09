import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  TarifsProposesEcran,
  type ActeAProposer,
  type TarifProposeLigne,
} from '@/components/dashboard/centre-medical/tarifs-proposes-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Tarifs proposés — Centre Médical' };

export default async function CentreMedicalTarifsProposesPage() {
  const etat = await exigerIdentite('/dashboard-centre-medical/tarifs-proposes');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const [resProp, resActes] = await Promise.all([
    apiFetch('/api/v1/tarifs-proposes'),
    apiFetch('/api/v1/tarifs-proposes/actes-a-proposer'),
  ]);
  const propositions: TarifProposeLigne[] = resProp.ok ? await resProp.json() : [];
  const actes: ActeAProposer[] = resActes.ok ? await resActes.json() : [];
  // seuls le comptable et l'administratif voient la liste des actes à proposer (l'API refuse les autres en 403)
  const peutProposer = resActes.ok;
  const erreur = resProp.ok ? null : await messageErreur(resProp);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Tarifs proposés"
        description="Actes non tarifables : proposez un montant avec justification pour les facturer à titre provisoire."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <TarifsProposesEcran propositions={propositions} actes={actes} peutProposer={peutProposer} />
      )}
    </div>
  );
}
