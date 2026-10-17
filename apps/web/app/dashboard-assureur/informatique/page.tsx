import { GraphiquesSoinsServeur } from '@/components/dashboard/exploitation/graphiques-soins-serveur';
import type { Metadata } from 'next';

import { InformatiqueVueEnsemble } from '@/components/dashboard/informatique-vue-ensemble';
import { PageTitre } from '@/components/page-titre';

export const metadata: Metadata = { title: 'Assurance Informatique' };

export default function VueEnsemble() {
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Vue d’ensemble"
        description="Espace Assurance Informatique. Sélectionnez une section pour commencer."
      />
      <GraphiquesSoinsServeur />
      <InformatiqueVueEnsemble />
    </div>
  );
}
