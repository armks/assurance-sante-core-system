import type { Metadata } from 'next';

import {
  DossiersSupervisionEcran,
  type DossierSupervisionResume,
} from '@/components/dashboard/exploitation/dossiers-supervision-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { periodeDepuisUrl, requetePeriode } from '@/lib/periode';

export const metadata: Metadata = {
  title: 'Dossiers de soins — Assurance Exploitation',
};

export default async function DossiersSupervision({
  searchParams,
}: {
  searchParams: Promise<{ du?: string; au?: string }>;
}) {
  const periode = periodeDepuisUrl(await searchParams);
  const res = await apiFetch(`/api/v1/care-episode/dossiers${requetePeriode(periode)}`);
  const dossiers: DossierSupervisionResume[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Dossiers de soins"
        description="Supervision de tous les dossiers de soins de l’organisation, tous établissements confondus. La clôture forcée est réservée à l’Assurance Exploitation."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <DossiersSupervisionEcran dossiers={dossiers} periodeServeur={periode} />
      )}
    </div>
  );
}
