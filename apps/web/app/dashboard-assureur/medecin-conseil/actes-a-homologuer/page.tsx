import type { Metadata } from 'next';

import { chargerCatalogue } from '@/app/dashboard-assureur/catalogue-chargement';
import { CatalogueActivationEcran } from '@/components/dashboard/catalogue-activation-ecran';
import { PageTitre } from '@/components/page-titre';
import { exigerIdentite } from '@/lib/identity';
import { peutActiverReferentiel } from '@/lib/referentiel';

export const metadata: Metadata = { title: 'Actes du catalogue national' };

export default async function ActesDuCatalogue() {
  const [etat, actes] = await Promise.all([
    exigerIdentite('/dashboard-assureur/medecin-conseil/actes-a-homologuer'),
    chargerCatalogue('actes'),
  ]);
  const roleChain = etat.kind === 'ok' ? etat.identity.permissions?.roleChain ?? [] : [];

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Actes du catalogue national"
        description="Activez ou désactivez les actes homologués du catalogue national pour votre organisation : seuls les actes activés sont proposés à la saisie."
      />
      {actes.erreur ? (
        <p className="text-sm text-destructive">{actes.erreur}</p>
      ) : (
        <CatalogueActivationEcran type="actes" elements={actes.elements} peutGerer={peutActiverReferentiel(roleChain)} />
      )}
    </div>
  );
}
