import type { Metadata } from 'next';

import {
  DispensationsEcran,
  type DispensationAdherent,
} from '@/components/dashboard/adherent/dispensations-ecran';
import { PageTitre } from '@/components/page-titre';
import type { PageServeur } from '@/components/dashboard/patterns';
import { apiFetch, messageErreur } from '@/lib/api';
import { PAGE_VIDE, requeteListe, type ParametresUrl } from '@/lib/liste-serveur';

export const metadata: Metadata = { title: 'Dispensations — Adhérent' };

export default async function DispensationsPage({
  searchParams,
}: {
  searchParams: Promise<ParametresUrl>;
}) {
  const res = await apiFetch(`/api/v1/pharmacy/dispensations/mes-dispensations${requeteListe(await searchParams, ['du', 'au', 'statut'])}`);
  const dispensations: PageServeur<DispensationAdherent> = res.ok ? await res.json() : PAGE_VIDE;
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Mes dispensations"
        description="Le code de confirmation reste visible tant que la pharmacie attend votre validation. Toutes vos dispensations apparaissent ici, quelle que soit la pharmacie."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <DispensationsEcran dispensations={dispensations} />
      )}
    </div>
  );
}
