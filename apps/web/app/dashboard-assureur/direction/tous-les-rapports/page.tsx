import type { Metadata } from 'next';

import { CentreRapports } from '@/components/dashboard/rapports/centre-rapports';
import { PageTitre } from '@/components/page-titre';

export const metadata: Metadata = { title: 'Tous les rapports — Direction' };

export default function TousLesRapports() {
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Tous les rapports"
        description="Les rapports de tous les utilisateurs de la plateforme : assurance, établissements de santé, pharmacies, sociétés clientes et adhérents. Chacun propose des filtres multicritères et l’export en PDF ou Word."
      />
      <CentreRapports racine="/dashboard-assureur/direction" />
    </div>
  );
}
