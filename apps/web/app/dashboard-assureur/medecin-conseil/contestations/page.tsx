import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  MedecinConseilActesEcran,
  type ActeRevue,
  type ContestationActe,
} from '@/components/dashboard/medecin-conseil-actes-ecran';
import type { PageServeur } from '@/components/dashboard/patterns';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import { PAGE_VIDE, requeteListe, type ParametresUrl } from '@/lib/liste-serveur';

export const metadata: Metadata = { title: 'Contestations — Médecin Conseil' };

export default async function ActesAExaminer({
  searchParams,
}: {
  searchParams: Promise<ParametresUrl>;
}) {
  const etat = await exigerIdentite('/dashboard-assureur/medecin-conseil');
  if (etat.kind !== 'ok') redirect('/dashboard');

  // Pagination / recherche / filtres CÔTÉ SERVEUR : tout l'historique reste
  // accessible (l'ancienne liste s'arrêtait aux 200 actes les plus récents).
  const filtres = requeteListe(await searchParams, ['q', 'du', 'au', 'contestation', 'categorie']);
  const [resActes, resContestations] = await Promise.all([
    apiFetch(`/api/v1/contestation/actes-a-examiner${filtres}`),
    apiFetch('/api/v1/contestation/contestations-actes'),
  ]);
  const actes: PageServeur<ActeRevue> = resActes.ok ? await resActes.json() : PAGE_VIDE;
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
