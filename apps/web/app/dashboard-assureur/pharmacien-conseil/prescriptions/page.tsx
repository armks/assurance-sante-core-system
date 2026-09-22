import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  PharmacienConseilPrescriptionsEcran,
  type Contestation,
  type OrdonnanceRevue,
} from '@/components/dashboard/pharmacien-conseil-prescriptions-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Prescriptions — Pharmacien Conseil' };

export default async function PrescriptionsAExaminer() {
  const etat = await exigerIdentite('/dashboard-assureur/pharmacien-conseil');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const [resOrdonnances, resContestations] = await Promise.all([
    apiFetch('/api/v1/contestation/ordonnances-a-examiner'),
    apiFetch('/api/v1/contestation/contestations'),
  ]);
  const ordonnances: OrdonnanceRevue[] = resOrdonnances.ok ? await resOrdonnances.json() : [];
  const contestations: Contestation[] = resContestations.ok ? await resContestations.json() : [];
  const erreur = resOrdonnances.ok
    ? resContestations.ok
      ? null
      : await messageErreur(resContestations)
    : await messageErreur(resOrdonnances);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Prescriptions à examiner"
        description="Revue des ordonnances délivrées et mécanisme de contestation d'une ligne auprès de la pharmacie concernée."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <PharmacienConseilPrescriptionsEcran ordonnances={ordonnances} contestations={contestations} />
      )}
    </div>
  );
}
