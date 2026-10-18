import type { Metadata } from 'next';

import { RendezVousPage } from '@/components/rendez-vous/rendez-vous-page';

export const metadata: Metadata = { title: 'Mes rendez-vous' };

export default function Page() {
  return (
    <RendezVousPage
      mode="adherent"
      racine="/dashboard-adherent/rendez-vous"
      titre="Mes rendez-vous"
      description="Vos rendez-vous médicaux et ceux de vos bénéficiaires. Pour en demander un, écrivez à la secrétaire de l’assurance par la messagerie (bulle en bas à droite). Une fois confirmé, enregistrez-le dans votre Google Agenda."
    />
  );
}
