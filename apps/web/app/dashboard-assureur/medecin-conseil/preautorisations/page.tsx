import type { Metadata } from 'next';

import type { ActeExploitation } from '@/components/dashboard/exploitation-preautorisations-ecran';
import { PreautorisationsConseilEcran } from '@/components/dashboard/preautorisations-conseil-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Pré-autorisations — Médecin Conseil' };

export default async function PreautorisationsMedecinConseil() {
  const res = await apiFetch(
    '/api/v1/preauthorization/actes/en-attente-preautorisation',
  );
  const actes: ActeExploitation[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Analyses / examens en attente de pré-autorisation"
        description="Aucun paiement patient n'est possible sur ces actes tant qu'ils n'ont pas été approuvés ou refusés explicitement."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <PreautorisationsConseilEcran actes={actes} />
      )}
    </div>
  );
}
