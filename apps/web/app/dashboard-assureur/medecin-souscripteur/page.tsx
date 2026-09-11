import type { Metadata } from 'next';

import {
  QuestionnairesEcran,
  type QuestionnaireLigne,
} from '@/components/dashboard/underwriting/questionnaires-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Vue d’ensemble — Médecin Souscripteur',
};

export default async function MedecinSouscripteurAccueil() {
  const res = await apiFetch('/api/v1/underwriting/questionnaires');
  const questionnaires: QuestionnaireLigne[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Vue d’ensemble"
        description="Espace Médecin Souscripteur — évaluation médicale des souscriptions individuelles. Séparation stricte : le médecin conseil (liquidation des sinistres) n’a aucun accès à ces questionnaires."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <QuestionnairesEcran questionnaires={questionnaires} />
      )}
    </div>
  );
}
