import type { Metadata } from 'next';

import {
  PolicesEcran,
  type OptionRef,
  type PoliceListe,
} from '@/components/dashboard/polices-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Polices — Assurance Informatique' };

export default async function Polices() {
  const [resPolices, resSousc, resProduits] = await Promise.all([
    apiFetch('/api/v1/policy/polices'),
    apiFetch('/api/v1/tenant/souscripteurs'),
    apiFetch('/api/v1/plan/produits?statut=PUBLIE'),
  ]);

  const polices: PoliceListe[] = resPolices.ok ? await resPolices.json() : [];
  const erreur = resPolices.ok ? null : await messageErreur(resPolices);
  const souscripteurs: OptionRef[] = resSousc.ok ? await resSousc.json() : [];
  const produitsPublies: OptionRef[] = resProduits.ok
    ? await resProduits.json()
    : [];

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Polices"
        description="Contrats collectifs : machine à états stricte (DEVIS → EN_SOUSCRIPTION → ACTIVE → …) et avenants. Module policy/."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <PolicesEcran
          polices={polices}
          souscripteurs={souscripteurs}
          produitsPublies={produitsPublies}
        />
      )}
    </div>
  );
}
