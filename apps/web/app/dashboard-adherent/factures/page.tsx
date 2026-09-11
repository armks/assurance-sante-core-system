import type { Metadata } from 'next';

import {
  FacturesEcran,
  type FactureAdherent,
} from '@/components/dashboard/adherent/factures-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Factures — Adhérent' };

export default async function FacturesPage() {
  const res = await apiFetch('/api/v1/preauthorization/codes-facturation');
  const factures: FactureAdherent[] = res.ok ? await res.json() : [];
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
