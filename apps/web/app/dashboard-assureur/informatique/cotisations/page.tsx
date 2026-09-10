import type { Metadata } from 'next';

import {
  CotisationsEcran,
  type Cotisation,
  type Grille,
  type OptionPolice,
  type OptionRef,
} from '@/components/dashboard/cotisations-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Cotisations — Assurance Informatique',
};

export default async function Cotisations() {
  const [resCot, resGrilles, resPolices, resSousc, resProduits] =
    await Promise.all([
      apiFetch('/api/v1/billing/cotisations'),
      apiFetch('/api/v1/billing/grilles-tarifaires'),
      apiFetch('/api/v1/policy/polices?statut=ACTIVE'),
      apiFetch('/api/v1/tenant/souscripteurs'),
      apiFetch('/api/v1/plan/produits'),
    ]);

  const cotisations: Cotisation[] = resCot.ok ? await resCot.json() : [];
  const erreur = resCot.ok ? null : await messageErreur(resCot);
  const grilles: Grille[] = resGrilles.ok ? await resGrilles.json() : [];
  const polices: OptionPolice[] = resPolices.ok ? await resPolices.json() : [];
  const souscripteurs: OptionRef[] = resSousc.ok ? await resSousc.json() : [];
  const produits: OptionRef[] = resProduits.ok ? await resProduits.json() : [];

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Cotisations"
        description="Appels de cotisation et grilles tarifaires. Priorité au tarif NÉGOCIÉ du souscripteur sur le tarif STANDARD du produit. Module billing/."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <CotisationsEcran
          cotisations={cotisations}
          grilles={grilles}
          polices={polices}
          souscripteurs={souscripteurs}
          produits={produits}
        />
      )}
    </div>
  );
}
