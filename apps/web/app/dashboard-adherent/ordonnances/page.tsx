import type { Metadata } from 'next';

import {
  OrdonnancesEcran,
  type CodeOrdonnance,
} from '@/components/dashboard/adherent/ordonnances-ecran';
import { PageTitre } from '@/components/page-titre';
import type { PageServeur } from '@/components/dashboard/patterns';
import { apiFetch, messageErreur } from '@/lib/api';
import { PAGE_VIDE, requeteListe, type ParametresUrl } from '@/lib/liste-serveur';

export const metadata: Metadata = { title: 'Ordonnances — Adhérent' };

export default async function OrdonnancesPage({
  searchParams,
}: {
  searchParams: Promise<ParametresUrl>;
}) {
  const res = await apiFetch(`/api/v1/preauthorization/codes-ordonnance${requeteListe(await searchParams, ['du', 'au', 'statut'])}`);
  const codes: PageServeur<CodeOrdonnance> = res.ok ? await res.json() : PAGE_VIDE;
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Mes ordonnances"
        description="Le code de retrait reste visible tant qu’il n’a pas été entièrement délivré en pharmacie."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <OrdonnancesEcran codes={codes} />
      )}
    </div>
  );
}
