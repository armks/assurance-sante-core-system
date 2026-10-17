import type { Metadata } from 'next';

import {
  CotisationsSocieteListe,
  type CotisationSociete,
} from '@/components/dashboard/societe/cotisations-societe-liste';
import { GraphiquesCotisations } from '@/components/dashboard/graphiques-roles';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Cotisations — Société' };

export default async function ComptableAccueil() {
  const res = await apiFetch('/api/v1/billing/cotisations');
  const cotisations: CotisationSociete[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Cotisations"
        description="Facturation de votre contrat : appels de cotisation, échéances et paiements enregistrés."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <>
          <GraphiquesCotisations cotisations={cotisations} />
          <CotisationsSocieteListe cotisations={cotisations} />
        </>
      )}
    </div>
  );
}
