import type { Metadata } from 'next';

import {
  AssureeEcran,
  type CotisationAssuree,
  type PoliceAssuree,
  type ProduitAvecGaranties,
} from '@/components/dashboard/societe/assuree-ecran';
import { GraphiquesCotisations } from '@/components/dashboard/graphiques-roles';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Vue d’ensemble — Société' };

export default async function AssureeAccueil() {
  const [resPolices, resCotisations] = await Promise.all([
    apiFetch('/api/v1/policy/polices'),
    apiFetch('/api/v1/billing/cotisations'),
  ]);
  const polices: PoliceAssuree[] = resPolices.ok ? await resPolices.json() : [];
  const erreur = resPolices.ok ? null : await messageErreur(resPolices);
  const cotisations: CotisationAssuree[] = resCotisations.ok
    ? await resCotisations.json()
    : [];

  const produitIds = [...new Set(polices.map((p) => p.produitId))];
  const produits = await Promise.all(
    produitIds.map(async (id) => {
      const r = await apiFetch(`/api/v1/plan/produits/${id}`);
      return r.ok ? ((await r.json()) as ProduitAvecGaranties) : null;
    }),
  );
  const garanties: Record<string, ProduitAvecGaranties> = {};
  produitIds.forEach((id, i) => {
    const p = produits[i];
    if (p) garanties[id] = p;
  });

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Vue d’ensemble"
        description="Espace Société — contact principal de l’entreprise cliente : votre police, vos cotisations et le fichier de vos adhérents."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <>
          <GraphiquesCotisations cotisations={cotisations} />
          <AssureeEcran
            polices={polices}
            garanties={garanties}
            cotisations={cotisations}
          />
        </>
      )}
    </div>
  );
}
