import type { Metadata } from 'next';

import {
  FacturesEcran,
  type FactureAdherent,
} from '@/components/dashboard/adherent/factures-ecran';
import { PageTitre } from '@/components/page-titre';
import type { PageServeur } from '@/components/dashboard/patterns';
import { apiFetch, messageErreur } from '@/lib/api';
import { PAGE_VIDE, requeteListe, type ParametresUrl } from '@/lib/liste-serveur';

export const metadata: Metadata = { title: 'Factures — Adhérent' };

export default async function FacturesPage({
  searchParams,
}: {
  searchParams: Promise<ParametresUrl>;
}) {
  const res = await apiFetch(`/api/v1/preauthorization/codes-facturation${requeteListe(await searchParams, ['du', 'au', 'statut'])}`);
  const factures: PageServeur<FactureAdherent> = res.ok ? await res.json() : PAGE_VIDE;
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Mes factures"
        description="Validez le code de facturation avant tout règlement — c’est la condition anti-fraude du remboursement."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <FacturesEcran factures={factures} />
      )}
    </div>
  );
}
