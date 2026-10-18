import type { Metadata } from 'next';

import { RapportDispensationsPage } from '@/components/dashboard/rapports/rapport-dispensations';
import { PageTitre } from '@/components/page-titre';

export const metadata: Metadata = { title: 'Rapport des dispensations — Comptable adjoint' };

export default function Rapport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Rapport des dispensations"
        description="Dispensations de pharmacie : volumes, montants assurance / patient, médicaments délivrés et anomalies de prix, avec critères multiples et export en PDF ou Word."
      />
      <RapportDispensationsPage searchParams={searchParams} racine="/dashboard-assureur/comptable-adjoint/rapports-dispensations" />
    </div>
  );
}
