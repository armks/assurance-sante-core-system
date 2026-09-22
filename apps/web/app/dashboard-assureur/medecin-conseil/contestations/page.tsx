import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  MedecinConseilActesEcran,
  type ActeRevue,
  type ContestationActe,
} from '@/components/dashboard/medecin-conseil-actes-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Contestations — Médecin Conseil' };

export default async function ActesAExaminer() {
  const etat = await exigerIdentite('/dashboard-assureur/medecin-conseil');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const [resActes, resContestations] = await Promise.all([
    apiFetch('/api/v1/contestation/actes-a-examiner'),
    apiFetch('/api/v1/contestation/contestations-actes'),
  ]);
  const actes: ActeRevue[] = resActes.ok ? await resActes.json() : [];
  const contestations: ContestationActe[] = resContestations.ok ? await resContestations.json() : [];
  const erreur = resActes.ok
    ? resContestations.ok
      ? null
      : await messageErreur(resContestations)
    : await messageErreur(resActes);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Contestations d'actes"
        description="Revue des actes/hospitalisations/analyses-examens et mécanisme de contestation auprès de l'établissement concerné."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <MedecinConseilActesEcran actes={actes} contestations={contestations} />
      )}
    </div>
  );
}
