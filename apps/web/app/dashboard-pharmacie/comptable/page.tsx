import type { Metadata } from 'next';

import { ComptableEcran } from '@/components/dashboard/pharmacie/comptable-ecran';
import type { CodeOrdonnancePharmacie } from '@/app/dashboard-pharmacie/types';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Suivi des dispensations — Comptable' };

export default async function ComptablePage() {
  const res = await apiFetch('/api/v1/preauthorization/codes-ordonnance/pharmacie');
  const codes: CodeOrdonnancePharmacie[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Suivi des dispensations"
        description="Vue d’ensemble des dispensations de votre pharmacie."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <ComptableEcran codes={codes} />
      )}
    </div>
  );
}
