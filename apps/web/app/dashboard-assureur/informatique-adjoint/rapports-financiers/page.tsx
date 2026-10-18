import type { Metadata } from 'next';

import { RapportFinancesPage } from '@/components/dashboard/rapports/rapport-finance-pages';
import { PageTitre } from '@/components/page-titre';

export const metadata: Metadata = { title: 'Rapport financier — Informatique adjoint' };

export default function Rapport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Rapport financier"
        description="Soldes des comptes, entrées et sorties par mois et par type de mouvement, avec critères multiples et export en PDF ou Word."
      />
      <RapportFinancesPage searchParams={searchParams} racine="/dashboard-assureur/informatique-adjoint/rapports-financiers" />
    </div>
  );
}
