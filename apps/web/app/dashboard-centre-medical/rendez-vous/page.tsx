import type { Metadata } from 'next';

import { RendezVousPage } from '@/components/rendez-vous/rendez-vous-page';

export const metadata: Metadata = { title: 'Rendez-vous — Établissement' };

export default function Page() {
  return (
    <RendezVousPage
      mode="etablissement"
      racine="/dashboard-centre-medical/rendez-vous"
      titre="Rendez-vous des patients"
      description="Propositions de rendez-vous reçues de l’assurance : confirmez, modifiez la date ou l’heure, ou refusez. L’accueil voit tous les rendez-vous de l’établissement, chaque médecin les siens."
    />
  );
}
