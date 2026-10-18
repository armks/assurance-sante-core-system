import type { Metadata } from 'next';

import { RapportActivitePage } from '@/components/dashboard/rapports/rapport-activite-page';
import { PageTitre } from '@/components/page-titre';

export const metadata: Metadata = { title: 'Rapports — Pharmacien conseil' };

export default function RapportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Rapports et statistiques"
        description="Activité des dossiers de soins avec critères multiples (période, établissement, société, catégorie d’acte, médecin…) et export en PDF ou Word."
      />
      <RapportActivitePage searchParams={searchParams} racine="/dashboard-assureur/pharmacien-conseil/rapports" />
    </div>
  );
}
