'use client';

import Link from 'next/link';
import { ClipboardList, FileCheck2 } from 'lucide-react';

import {
  CarteResume,
  DataTable,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import {
  DECISIONS_QUESTIONNAIRE,
  LIBELLE_STATUT_QUESTIONNAIRE,
  TON_DECISION,
  statutQuestionnaire,
} from '@/lib/underwriting';

export interface QuestionnaireLigne {
  id: string;
  souscripteurId: string;
  souscripteur: { id: string; nom: string; type: string } | null;
  decision: string | null;
  dateSoumission: string | null;
  dateDecision: string | null;
  surprimePourcent: string | number | null;
  createdAt: string;
}

const RACINE = '/dashboard-assureur/medecin-souscripteur';
const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';

function memeMois(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
}

export function QuestionnairesEcran({
  questionnaires,
}: {
  questionnaires: QuestionnaireLigne[];
}) {
  const parDecision = (d: string) =>
    questionnaires.filter((q) => q.decision === d).length;
  const enAttente = questionnaires.filter((q) => q.decision === null).length;
  const decisionsCeMois = questionnaires.filter((q) =>
    memeMois(q.dateDecision),
  ).length;

  const colonnes: ColonneTable<QuestionnaireLigne>[] = [
    {
      cle: 'souscripteur',
      entete: 'Souscripteur',
      triable: true,
      valeur: (q) => q.souscripteur?.nom ?? '',
      rendu: (q) => q.souscripteur?.nom ?? '—',
    },
    {
      cle: 'dateSoumission',
      entete: 'Soumis le',
      triable: true,
      valeur: (q) => q.dateSoumission ?? q.createdAt,
      rendu: (q) => dateFr(q.dateSoumission ?? q.createdAt),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (q) => (
        <StatutBadge
          statut={statutQuestionnaire(q.decision)}
          map={TON_DECISION}
          libelles={LIBELLE_STATUT_QUESTIONNAIRE}
        />
      ),
    },
    {
      cle: 'dateDecision',
      entete: 'Décision le',
      triable: true,
      valeur: (q) => q.dateDecision ?? '',
      rendu: (q) => dateFr(q.dateDecision),
    },
  ];

  return (
    <div className="space-y-6">
      <GrilleCartes>
        <CarteResume
          libelle="En attente d’évaluation"
          valeur={enAttente}
          icon={ClipboardList}
        />
        <CarteResume
          libelle="Décisions rendues ce mois"
          valeur={decisionsCeMois}
          icon={FileCheck2}
        />
        <CarteResume libelle="Accepté" valeur={parDecision('ACCEPTE')} />
        <CarteResume
          libelle="Accepté avec exclusion"
          valeur={parDecision('ACCEPTE_AVEC_EXCLUSION')}
        />
        <CarteResume
          libelle="Accepté avec surprime"
          valeur={parDecision('ACCEPTE_SURPRIME')}
        />
        <CarteResume libelle="Refusé" valeur={parDecision('REFUSE')} />
      </GrilleCartes>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Questionnaires médicaux des souscripteurs individuels de l’organisation.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href={`${RACINE}/tarifications`}>Tarifications calculées</Link>
        </Button>
      </div>

      <DataTable
        donnees={questionnaires}
        cleLigne={(q) => q.id}
        parPage={15}
        recherche={{
          placeholder: 'Souscripteur…',
          champs: ['souscripteur.nom'],
        }}
        filtres={[
          {
            cle: 'statut',
            libelle: 'Statut',
            valeur: (q) =>
              statutQuestionnaire((q as QuestionnaireLigne).decision),
            options: [
              { valeur: 'EN_ATTENTE', libelle: 'En attente d’évaluation' },
              ...DECISIONS_QUESTIONNAIRE.map((d) => ({
                valeur: d,
                libelle: LIBELLE_STATUT_QUESTIONNAIRE[d],
              })),
            ],
          },
        ]}
        colonnes={colonnes}
        actionLigne={(q) => (
          <Button asChild size="xs" variant="ghost">
            <Link href={`${RACINE}/${q.id}`}>
              {q.decision === null ? 'Évaluer' : 'Détail'}
            </Link>
          </Button>
        )}
        vide="Aucun questionnaire médical pour l’instant."
      />
    </div>
  );
}
