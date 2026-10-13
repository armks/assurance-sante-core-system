import type { Metadata } from 'next';

import { chargerCatalogue } from '@/app/dashboard-assureur/catalogue-chargement';
import { CatalogueActivationEcran } from '@/components/dashboard/catalogue-activation-ecran';
import { PageTitre } from '@/components/page-titre';
import { exigerIdentite } from '@/lib/identity';
import { peutActiverReferentiel } from '@/lib/referentiel';

export const metadata: Metadata = { title: 'Médicaments du catalogue national' };

export default async function MedicamentsDuCatalogue() {
  const [etat, medicaments] = await Promise.all([
    exigerIdentite('/dashboard-assureur/pharmacien-conseil/medicaments-a-homologuer'),
    chargerCatalogue('medicaments'),
  ]);
  const roleChain = etat.kind === 'ok' ? etat.identity.permissions?.roleChain ?? [] : [];

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Médicaments du catalogue national"
        description="Activez ou désactivez les médicaments homologués du catalogue national pour votre organisation : seuls les médicaments activés sont proposés à la saisie des ordonnances."
      />
      {medicaments.erreur ? (
        <p className="text-sm text-destructive">{medicaments.erreur}</p>
      ) : (
        <CatalogueActivationEcran type="medicaments" elements={medicaments.elements} peutGerer={peutActiverReferentiel(roleChain)} />
      )}
    </div>
  );
}
