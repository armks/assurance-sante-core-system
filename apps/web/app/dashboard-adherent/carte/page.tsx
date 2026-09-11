import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { CarteEcran } from '@/components/dashboard/adherent/carte-ecran';
import { PageTitre } from '@/components/page-titre';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Ma carte — Adhérent' };

export default async function CartePage() {
  const etat = await exigerIdentite('/dashboard-adherent/carte');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const adherentId = etat.identity.permissions.scope.adherentId;
  if (!adherentId) {
    return (
      <div className="space-y-8">
        <PageTitre titre="Ma carte" />
        <p className="text-sm text-destructive">
          Votre compte n’est rattaché à aucun adhérent — contactez votre assureur.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Ma carte de membre"
        description="Génère un PDF avec QR code, à présenter ou imprimer."
      />
      <CarteEcran adherentId={adherentId} />
    </div>
  );
}
