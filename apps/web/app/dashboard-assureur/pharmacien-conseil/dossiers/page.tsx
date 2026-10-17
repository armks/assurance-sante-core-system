import type { Metadata } from 'next';

import {
  DossiersSupervisionEcran,
  type DossierSupervisionResume,
} from '@/components/dashboard/exploitation/dossiers-supervision-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { periodeDepuisUrl, requetePeriode } from '@/lib/periode';

export const metadata: Metadata = { title: 'Dossiers de soins — Pharmacien Conseil' };

export default async function DossiersDeSoins({
  searchParams,
}: {
  searchParams: Promise<{ du?: string; au?: string }>;
}) {
  const periode = periodeDepuisUrl(await searchParams);
  const res = await apiFetch(`/api/v1/care-episode/dossiers${requetePeriode(periode, true)}`);
  const dossiers: DossierSupervisionResume[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Dossiers de soins"
        description="Dossiers de soins de l’organisation, tous établissements confondus : actes, consultations et prescriptions de chaque dossier."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <DossiersSupervisionEcran dossiers={dossiers} periodeServeur={periode} detailsALaDemande racineDossier="/dashboard-assureur/pharmacien-conseil/dossiers" />
      )}
    </div>
  );
}
