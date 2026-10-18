import type { Metadata } from 'next';

import { RapportActivitePage } from '@/components/dashboard/rapports/rapport-activite-page';
import { PageTitre } from '@/components/page-titre';

export const metadata: Metadata = { title: 'Rapports — Centre médical' };

export default function Rapport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Rapports et statistiques"
        description="Activité des dossiers de soins de votre établissement avec critères multiples (période, catégorie d’acte, médecin…) et export en PDF ou Word."
      />
      <RapportActivitePage searchParams={searchParams} racine="/dashboard-centre-medical/rapports" />
    </div>
  );
}
