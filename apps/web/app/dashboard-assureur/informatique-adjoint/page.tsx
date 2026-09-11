import type { Metadata } from 'next';

import { InformatiqueVueEnsemble } from '@/components/dashboard/informatique-vue-ensemble';
import { PageTitre } from '@/components/page-titre';

export const metadata: Metadata = { title: 'Assurance Informatique (adjoint)' };

export default function VueEnsembleAdjoint() {
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Vue d’ensemble"
        description="Espace Assurance Informatique — rôle adjoint. Mêmes écrans que le titulaire, sans les actions de validation finale."
      />
      <InformatiqueVueEnsemble adjoint />
    </div>
  );
}
