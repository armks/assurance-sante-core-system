'use client';

import { Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { evaluerQuestionnaire } from '@/app/dashboard-assureur/medecin-souscripteur/actions';
import { StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  DECISIONS_QUESTIONNAIRE,
  LIBELLE_DECISION,
  LIBELLE_STATUT_QUESTIONNAIRE,
  TON_DECISION,
  statutQuestionnaire,
  type DecisionQuestionnaire,
} from '@/lib/underwriting';

export interface QuestionnaireDetailData {
  id: string;
  souscripteur: { id: string; nom: string; type: string } | null;
  reponses: Record<string, unknown>;
  antecedentsDeclares: string[];
  decision: string | null;
  exclusionsSpecifiques: string[];
  surprimePourcent: string | number | null;
  dateSoumission: string | null;
  dateDecision: string | null;
}

const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';

function valeurReponse(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const CHAMP_SELECT =
  'h-9 rounded-md border border-input bg-transparent px-3 text-sm';

export function QuestionnaireDetail({
  questionnaire,
}: {
  questionnaire: QuestionnaireDetailData;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [decision, setDecision] = useState<DecisionQuestionnaire>('ACCEPTE');
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurs, setErreurs] = useState<string[]>([]);

  const rendu = questionnaire.decision !== null;
  const reponses = Object.entries(questionnaire.reponses ?? {});

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
          <CardTitle className="text-base">Réponses au questionnaire</CardTitle>
        </CardHeader>
        <CardContent>
          {reponses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune réponse saisie.</p>
          ) : (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {reponses.map(([cle, val]) => (
                <div key={cle} className="flex justify-between gap-3 border-b py-1.5">
                  <dt className="text-muted-foreground">{cle}</dt>
                  <dd className="font-medium">{valeurReponse(val)}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Antécédents déclarés</CardTitle>
        </CardHeader>
        <CardContent>
          {questionnaire.antecedentsDeclares.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun antécédent déclaré.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {questionnaire.antecedentsDeclares.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Décision médicale</CardTitle>
        </CardHeader>
        <CardContent>
          {rendu ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-sky-800 dark:text-sky-300">
                <Lock className="mt-0.5 size-4 shrink-0" />
                <p>
                  Décision déjà rendue :{' '}
                  <strong>
                    {LIBELLE_DECISION[questionnaire.decision as string] ??
                      questionnaire.decision}
                  </strong>
                  . Une décision est définitive.
                </p>
              </div>
              {questionnaire.decision === 'ACCEPTE_SURPRIME' && (
                <p>
                  Surprime :{' '}
                  <strong>{Number(questionnaire.surprimePourcent)} %</strong>
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
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setErreur(null);
                setErreurs([]);
                const fd = new FormData(e.currentTarget);
                const surprimeRaw = fd.get('surprimePourcent');
                const exclusions = String(fd.get('exclusionsSpecifiques') ?? '')
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean);
                start(async () => {
                  const r = await evaluerQuestionnaire(questionnaire.id, {
                    decision,
                    surprimePourcent:
                      decision === 'ACCEPTE_SURPRIME' && surprimeRaw
                        ? Number(surprimeRaw)
                        : undefined,
                    exclusionsSpecifiques: exclusions,
                  });
                  if (r.ok) {
                    router.refresh();
                  } else {
                    setErreur(r.error);
                    setErreurs(r.erreurs ?? []);
                  }
                });
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="decision">Décision</Label>
                <select
                  id="decision"
                  name="decision"
                  className={CHAMP_SELECT}
                  value={decision}
                  onChange={(ev) =>
                    setDecision(ev.target.value as DecisionQuestionnaire)
                  }
                >
                  {DECISIONS_QUESTIONNAIRE.map((d) => (
                    <option key={d} value={d}>
                      {LIBELLE_DECISION[d]}
                    </option>
                  ))}
                </select>
              </div>

              {decision === 'ACCEPTE_SURPRIME' && (
                <div className="grid gap-2">
                  <Label htmlFor="surprimePourcent">Surprime (%)</Label>
                  <input
                    id="surprimePourcent"
                    name="surprimePourcent"
                    type="number"
                    min={0.01}
                    max={500}
                    step="0.01"
                    required
                    className={CHAMP_SELECT}
                  />
                  <p className="text-xs text-muted-foreground">
                    Strictement positive. Appliquée à la prime de base lors de la
                    tarification.
                  </p>
                </div>
              )}

              {decision === 'ACCEPTE_AVEC_EXCLUSION' && (
                <div className="grid gap-2">
                  <Label htmlFor="exclusionsSpecifiques">
                    Exclusions spécifiques
                  </Label>
                  <textarea
                    id="exclusionsSpecifiques"
                    name="exclusionsSpecifiques"
                    rows={3}
                    required
                    placeholder="Une exclusion par ligne"
                    className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Au moins une exclusion (une par ligne).
                  </p>
                </div>
              )}

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

              <Button type="submit" disabled={pending}>
                {pending ? 'Enregistrement…' : 'Rendre la décision'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
