import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  IndividuelVueEnsemble,
  type MaTarification,
  type MonQuestionnaire,
} from '@/components/dashboard/individuel-vue-ensemble';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Mon dossier de souscription' };

const CIBLE = '/dashboard-adherent/individuel';

/**
 * Corrige le 404 `SOUSCRIPTEUR_INDIVIDUEL` (dashboardRoute configuré en base
 * sans page frontend). `UnderwritingService.listerQuestionnaires` /
 * `listerTarifications` scopent déjà en self-service sur `ctx.societeId` —
 * seul manquait le provisioning réel (migration 029) et cet écran.
 */
export default async function IndividuelAccueil() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const societeId = etat.identity.permissions.scope.societeId as string | null;
  if (!societeId) {
    return (
      <div className="space-y-8">
        <PageTitre titre="Mon dossier de souscription" />
        <p className="text-sm text-destructive">
          Votre compte n’est rattaché à aucun dossier de souscription individuelle. Contactez
          votre administrateur.
        </p>
      </div>
    );
  }

  const resQuestionnaires = await apiFetch('/api/v1/underwriting/questionnaires');
  const questionnaires: MonQuestionnaire[] = resQuestionnaires.ok
    ? await resQuestionnaires.json()
    : [];
  const erreur = resQuestionnaires.ok ? null : await messageErreur(resQuestionnaires);
  const questionnaire = questionnaires[0] ?? null;

  let tarification: MaTarification | null = null;
  if (questionnaire && questionnaire.decision !== null) {
    const resTarifs = await apiFetch('/api/v1/underwriting/tarifications');
    const tarifications: MaTarification[] = resTarifs.ok ? await resTarifs.json() : [];
    tarification = tarifications.find((t) => t.questionnaireMedicalId === questionnaire.id) ?? null;
  }

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Mon dossier de souscription"
        description="Questionnaire médical et tarification de votre police individuelle."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <IndividuelVueEnsemble
          questionnaire={questionnaire}
          tarification={tarification}
          societeId={societeId}
        />
      )}
    </div>
  );
}
