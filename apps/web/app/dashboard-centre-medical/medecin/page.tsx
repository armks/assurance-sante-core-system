import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  DossiersEcran,
  type DossierResume,
} from '@/components/dashboard/centre-medical/dossiers-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Dossiers de soins — Parcours de soins' };

export default async function MedecinPage() {
  const etat = await exigerIdentite('/dashboard-centre-medical/medecin');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const etablissementId = etat.identity.permissions.scope
    .etablissementId as string;

  const res = await apiFetch(
    `/api/v1/care-episode/dossiers?statut=OUVERT&etablissementId=${etablissementId}`,
  );
  const dossiers: DossierResume[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Dossiers de soins ouverts"
        description="Les épisodes de soins en cours dans votre établissement. Ouvrez un dossier pour ajouter une consultation, un acte, une ordonnance, ou le clôturer."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <DossiersEcran dossiers={dossiers} />
      )}
    </div>
  );
}
