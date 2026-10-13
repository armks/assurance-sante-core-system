import type { Metadata } from 'next';
import { Pill, Stethoscope } from 'lucide-react';

import { chargerCatalogue } from '@/app/dashboard-assureur/catalogue-chargement';
import { CatalogueActivationEcran } from '@/components/dashboard/catalogue-activation-ecran';
import { PageTitre } from '@/components/page-titre';
import { exigerIdentite } from '@/lib/identity';
import { peutActiverReferentiel } from '@/lib/referentiel';

export const metadata: Metadata = {
  title: 'Référentiel médical — Assurance Informatique',
};

export default async function ReferentielMedical() {
  const [etat, actes, medicaments] = await Promise.all([
    exigerIdentite('/dashboard-assureur/informatique/referentiel-medical'),
    chargerCatalogue('actes'),
    chargerCatalogue('medicaments'),
  ]);
  const roleChain = etat.kind === 'ok' ? etat.identity.permissions?.roleChain ?? [] : [];
  const peutGerer = peutActiverReferentiel(roleChain);

  return (
    <div className="space-y-10">
      <PageTitre
        titre="Référentiel médical"
        description="Le référentiel médical est le catalogue national : activez ou désactivez les actes et médicaments homologués. Seuls les éléments activés sont proposés à la saisie."
      />
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Stethoscope className="size-5 text-muted-foreground" /> Actes
        </h2>
        {actes.erreur ? <p className="text-sm text-destructive">{actes.erreur}</p> : <CatalogueActivationEcran type="actes" elements={actes.elements} peutGerer={peutGerer} />}
      </section>
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Pill className="size-5 text-muted-foreground" /> Médicaments
        </h2>
        {medicaments.erreur ? (
          <p className="text-sm text-destructive">{medicaments.erreur}</p>
        ) : (
          <CatalogueActivationEcran type="medicaments" elements={medicaments.elements} peutGerer={peutGerer} />
        )}
      </section>
    </div>
  );
}
