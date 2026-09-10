import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  FacturationEcran,
  type DossierClot,
} from '@/components/dashboard/centre-medical/facturation-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Facturation — Parcours de soins' };

export default async function ComptablePage() {
  const etat = await exigerIdentite('/dashboard-centre-medical/comptable');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const etablissementId = etat.identity.permissions.scope
    .etablissementId as string;

  const [rc, rf] = await Promise.all([
    apiFetch(
      `/api/v1/care-episode/dossiers?statut=CLOTURE&etablissementId=${etablissementId}`,
    ),
    apiFetch(
      `/api/v1/care-episode/dossiers?statut=FORCE_CLOS&etablissementId=${etablissementId}`,
    ),
  ]);
  const dossiers: DossierClot[] = [
    ...(rc.ok ? await rc.json() : []),
    ...(rf.ok ? await rf.json() : []),
  ];
  const erreur = rc.ok ? null : await messageErreur(rc);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Facturation"
        description="Les dossiers clôturés de votre établissement. Ouvrez-en un pour consulter les actes, générer la facture, et suivre la validation du patient."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <FacturationEcran dossiers={dossiers} />
      )}
    </div>
  );
}
