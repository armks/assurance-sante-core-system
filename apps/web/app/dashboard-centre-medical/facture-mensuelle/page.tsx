import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  FactureMensuelleEtablissementEcran,
  type ActeDuMois,
  type FactureMensuelleEtablissement,
} from '@/components/dashboard/centre-medical/facture-mensuelle-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Facture mensuelle — Établissement' };

const CIBLE = '/dashboard-centre-medical/facture-mensuelle';

export default async function FactureMensuelleEtablissementPage() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const [resActes, resFactures] = await Promise.all([
    apiFetch('/api/v1/preauthorization/factures-mensuelles-etablissement/mois-en-cours'),
    apiFetch('/api/v1/preauthorization/factures-mensuelles-etablissement/mes-factures'),
  ]);
  const actesDuMois: ActeDuMois[] = resActes.ok ? await resActes.json() : [];
  const factures: FactureMensuelleEtablissement[] = resFactures.ok ? await resFactures.json() : [];
  const erreur = resActes.ok ? (resFactures.ok ? null : await messageErreur(resFactures)) : await messageErreur(resActes);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Facture mensuelle"
        description="Consolidation mensuelle du montant dû par l’assureur pour les actes payés de votre établissement."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <FactureMensuelleEtablissementEcran actesDuMois={actesDuMois} factures={factures} />
      )}
    </div>
  );
}
