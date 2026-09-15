'use client';

import { Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { soumettreMonQuestionnaire } from '@/app/dashboard-adherent/individuel/actions';
import { StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  LIBELLE_DECISION,
  LIBELLE_STATUT_QUESTIONNAIRE,
  TON_DECISION,
  statutQuestionnaire,
} from '@/lib/underwriting';

export interface MonQuestionnaire {
  id: string;
  reponses: Record<string, unknown>;
  antecedentsDeclares: string[];
  decision: string | null;
  exclusionsSpecifiques: string[];
  surprimePourcent: string | number | null;
  dateSoumission: string | null;
  dateDecision: string | null;
}

export interface MaTarification {
  id: string;
  questionnaireMedicalId: string;
  ageASubscription: number;
  primeBase: string;
  surprimeMedicale: string;
  primeFinale: string | null;
  police: { numeroPolice: string };
}

const dateFr = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
const montantFr = (v: string | number | null) =>
  v === null ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;

function valeurReponse(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

const CHAMP_CHECKBOX = 'flex items-center gap-2 text-sm';
const CHAMP_TEXTE =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm';

/**
 * Vue d'ensemble `SOUSCRIPTEUR_INDIVIDUEL` — un seul écran, 3 états
 * possibles : questionnaire pas encore soumis (formulaire), soumis en
 * attente d'évaluation (décision jamais montrée avant d'être rendue —
 * `decision` est réellement `null` en base tant que le médecin souscripteur
 * n'a pas statué, contrainte CHECK côté DB), ou décision rendue (+ prime si
 * acceptée et déjà tarifée).
 */
export function IndividuelVueEnsemble({
  questionnaire,
  tarification,
  societeId,
}: {
  questionnaire: MonQuestionnaire | null;
  tarification: MaTarification | null;
  societeId: string;
}) {
  if (!questionnaire) {
    return <FormulaireSoumission societeId={societeId} />;
  }

  const rendu = questionnaire.decision !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatutBadge
          statut={statutQuestionnaire(questionnaire.decision)}
          map={TON_DECISION}
          libelles={LIBELLE_STATUT_QUESTIONNAIRE}
        />
        <span className="text-sm text-muted-foreground">
          Soumis le {dateFr(questionnaire.dateSoumission)}
          {rendu && ` · décision rendue le ${dateFr(questionnaire.dateDecision)}`}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Votre questionnaire</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {Object.entries(questionnaire.reponses ?? {}).map(([cle, val]) => (
              <div key={cle} className="flex justify-between gap-3 border-b py-1.5">
                <dt className="text-muted-foreground">{cle}</dt>
                <dd className="font-medium">{valeurReponse(val)}</dd>
              </div>
            ))}
          </dl>
          {questionnaire.antecedentsDeclares.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-muted-foreground">Antécédents déclarés :</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {questionnaire.antecedentsDeclares.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {!rendu ? (
        <Card className="border-dashed">
          <CardContent className="flex items-start gap-2 pt-6 text-sm text-muted-foreground">
            <Lock className="mt-0.5 size-4 shrink-0" />
            <p>
              Votre questionnaire est en cours d’évaluation par un médecin souscripteur. La
              décision ne vous sera visible qu’une fois rendue — vous recevrez alors le détail
              ici même.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Décision médicale</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Décision : <strong>{LIBELLE_DECISION[questionnaire.decision as string] ?? questionnaire.decision}</strong>
            </p>
            {questionnaire.decision === 'ACCEPTE_SURPRIME' && (
              <p>
                Surprime médicale : <strong>{Number(questionnaire.surprimePourcent)} %</strong>
              </p>
            )}
            {questionnaire.decision === 'ACCEPTE_AVEC_EXCLUSION' && (
              <div>
                <p className="text-muted-foreground">Exclusions spécifiques :</p>
                <ul className="mt-1 list-disc pl-5">
                  {questionnaire.exclusionsSpecifiques.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {rendu && questionnaire.decision !== 'REFUSE' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Votre prime</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!tarification ? (
              <p className="text-muted-foreground">
                Décision rendue — la tarification de votre police est en cours de finalisation.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between border-b py-1.5">
                  <span className="text-muted-foreground">Police</span>
                  <span className="font-medium">{tarification.police.numeroPolice}</span>
                </div>
                <div className="flex justify-between border-b py-1.5">
                  <span className="text-muted-foreground">Prime de base</span>
                  <span className="font-medium">{montantFr(tarification.primeBase)}</span>
                </div>
                <div className="flex justify-between border-b py-1.5">
                  <span className="text-muted-foreground">Surprime médicale</span>
                  <span className="font-medium">{montantFr(tarification.surprimeMedicale)}</span>
                </div>
                <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3">
                  <span className="text-sm font-medium">Prime finale (mensuelle)</span>
                  <span className="text-lg font-semibold">{montantFr(tarification.primeFinale)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FormulaireSoumission({ societeId }: { societeId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurs, setErreurs] = useState<string[]>([]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Questionnaire médical de souscription</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErreur(null);
            setErreurs([]);
            const fd = new FormData(e.currentTarget);
            const reponses: Record<string, unknown> = {
              fumeur: fd.get('fumeur') === 'on',
              diabete: fd.get('diabete') === 'on',
              hypertension: fd.get('hypertension') === 'on',
              maladieCardiaque: fd.get('maladieCardiaque') === 'on',
              traitementEnCours: String(fd.get('traitementEnCours') ?? ''),
            };
            const antecedentsDeclares = String(fd.get('antecedentsDeclares') ?? '')
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
            start(async () => {
              const r = await soumettreMonQuestionnaire(societeId, { reponses, antecedentsDeclares });
              if (r.ok) {
                router.refresh();
              } else {
                setErreur(r.error);
                setErreurs(r.erreurs ?? []);
              }
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={CHAMP_CHECKBOX}>
              <input type="checkbox" name="fumeur" className="size-4" /> Fumeur
            </label>
            <label className={CHAMP_CHECKBOX}>
              <input type="checkbox" name="diabete" className="size-4" /> Diabète
            </label>
            <label className={CHAMP_CHECKBOX}>
              <input type="checkbox" name="hypertension" className="size-4" /> Hypertension
            </label>
            <label className={CHAMP_CHECKBOX}>
              <input type="checkbox" name="maladieCardiaque" className="size-4" /> Maladie
              cardiaque
            </label>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="traitementEnCours">Traitement en cours (le cas échéant)</Label>
            <input id="traitementEnCours" name="traitementEnCours" className={CHAMP_TEXTE} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="antecedentsDeclares">Autres antécédents à déclarer</Label>
            <textarea
              id="antecedentsDeclares"
              name="antecedentsDeclares"
              rows={3}
              placeholder="Un antécédent par ligne"
              className={CHAMP_TEXTE}
            />
          </div>

          {(erreur || erreurs.length > 0) && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {erreur && <p className="font-medium">{erreur}</p>}
              {erreurs.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {erreurs.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Une fois soumis, ce questionnaire ne peut plus être modifié. La décision sera rendue
            par un médecin souscripteur — elle ne vous sera visible qu’une fois tranchée.
          </p>

          <Button type="submit" disabled={pending}>
            {pending ? 'Envoi…' : 'Soumettre le questionnaire'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
