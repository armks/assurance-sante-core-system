import type { Metadata } from 'next';

import {
  ProduitsEcran,
  type Produit,
} from '@/components/dashboard/produits-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Produits — Assurance Informatique' };

export default async function Produits() {
  const res = await apiFetch('/api/v1/plan/produits');
  const produits: Produit[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Produits"
        description="Formules d’assurance versionnées et leurs garanties. Une version publiée est immuable : toute évolution passe par une nouvelle version. Module plan/ (scopé par organisation)."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <ProduitsEcran produits={produits} />
      )}
    </div>
  );
}
