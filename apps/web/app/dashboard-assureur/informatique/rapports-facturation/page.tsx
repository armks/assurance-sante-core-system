import type { Metadata } from 'next';

import { RapportFacturationPage } from '@/components/dashboard/rapports/rapport-facturation-page';
import { PageTitre } from '@/components/page-titre';

export const metadata: Metadata = { title: 'Rapport de facturation — Informatique' };

export default function RapportFacturationMensuelle({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Rapport de facturation mensuelle"
        description="Factures mensuelles des établissements et des pharmacies : facturé, payé, restant dû, avec critères multiples et export en PDF ou Word."
      />
      <RapportFacturationPage searchParams={searchParams} racine="/dashboard-assureur/informatique/rapports-facturation" />
    </div>
  );
}
