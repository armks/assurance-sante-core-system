import type { Metadata } from 'next';

import { ReleveSoinsPage } from '@/components/dashboard/rapports/releve-soins';
import { PageTitre } from '@/components/page-titre';

export const metadata: Metadata = { title: 'Relevé d’un adhérent — Direction' };

export default function ReleveAdherent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Relevé de soins d’un adhérent"
        description="Recherchez un adhérent pour consulter ses soins et médicaments (et ceux de ses bénéficiaires), la part prise en charge et le reste à charge, avec export en PDF ou Word."
      />
      <ReleveSoinsPage searchParams={searchParams} racine="/dashboard-assureur/direction/releve-adherent" choixAdherent />
    </div>
  );
}
