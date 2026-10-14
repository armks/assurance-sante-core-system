import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AccueilEcran } from '@/components/dashboard/centre-medical/accueil-ecran';
import { PageTitre } from '@/components/page-titre';
import { ROLE_RECHERCHE_CARTE, ROLES_GESTION_DOSSIER, aUnRole } from '@/lib/centre-medical';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Accueil — Parcours de soins' };

export default async function AccueilPage() {
  const etat = await exigerIdentite('/dashboard-centre-medical/accueil');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const { permissions } = etat.identity;
  const etablissementId = permissions.scope.etablissementId as string;
  const peutValider = aUnRole(permissions.roleChain, ROLES_GESTION_DOSSIER);
  const peutRechercherCarte = aUnRole(permissions.roleChain, [ROLE_RECHERCHE_CARTE]);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Accueil — code de consultation"
        uneLigne
        description="Saisissez le code que le patient vous communique. La validation ouvre son dossier de soins pour cet établissement."
      />
      <AccueilEcran
        etablissementId={etablissementId}
        peutValider={peutValider}
        peutRechercherCarte={peutRechercherCarte}
      />
    </div>
  );
}
