import type { Metadata } from 'next';

import { PageTitre } from '@/components/page-titre';
import {
  SouscripteursEcran,
  type Souscripteur,
} from '@/components/dashboard/souscripteurs-ecran';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Souscripteurs — Assurance Informatique',
};

export default async function Souscripteurs() {
  const res = await apiFetch('/api/v1/tenant/souscripteurs');
  const souscripteurs: Souscripteur[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Souscripteurs"
        description="Entreprises, collectivités et souscripteurs individuels affiliés. Module tenant/ (scopé par organisation)."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <SouscripteursEcran souscripteurs={souscripteurs} />
      )}
    </div>
  );
}
