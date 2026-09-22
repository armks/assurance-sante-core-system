import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  MesFacturesEcran,
  type FactureDossierEtablissement,
} from '@/components/dashboard/centre-medical/mes-factures-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Mes factures — Établissement' };

export default async function MesFacturesEtablissementPage() {
  const etat = await exigerIdentite('/dashboard-centre-medical/mes-factures');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch('/api/v1/preauthorization/factures-dossier/mes-factures');
  const factures: FactureDossierEtablissement[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Mes factures"
        description="Toutes les factures de votre établissement — filtrez par société cliente, adhérent, statut ou période."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <MesFacturesEcran factures={factures} />
      )}
    </div>
  );
}
