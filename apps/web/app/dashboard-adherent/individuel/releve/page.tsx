import type { Metadata } from 'next';

import { ReleveSoinsPage } from '@/components/dashboard/rapports/releve-soins';
import { PageTitre } from '@/components/page-titre';

export const metadata: Metadata = { title: 'Mon relevé de soins — Souscripteur individuel' };

export default function Releve({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Mon relevé de soins"
        description="Vos soins et médicaments (et ceux de vos bénéficiaires) : pris en charge par l’assurance et reste à votre charge, à télécharger en PDF ou Word."
      />
      <ReleveSoinsPage searchParams={searchParams} racine="/dashboard-adherent/individuel/releve" />
    </div>
  );
}
