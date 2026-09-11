import type { Metadata } from 'next';

import {
  OrdonnancesEcran,
  type CodeOrdonnance,
} from '@/components/dashboard/adherent/ordonnances-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Ordonnances — Adhérent' };

export default async function OrdonnancesPage() {
  const res = await apiFetch('/api/v1/preauthorization/codes-ordonnance');
  const codes: CodeOrdonnance[] = res.ok ? await res.json() : [];
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
