'use client';

import { useState, useTransition } from 'react';

import {
  homologuerActe,
  homologuerMedicament,
  reproposerActe,
  reproposerMedicament,
  retirerActe,
  retirerMedicament,
  suspendreActe,
  suspendreMedicament,
  type ResultatReference,
} from '@/app/dashboard-assureur/reference-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LIBELLE_STATUT_HOMOLOGATION } from '@/lib/referentiel';

export interface ActeRef {
  id: string;
  code: string;
  libelle: string;
  categorie: string | null;
  statut: string;
}

export interface MedicamentRef {
  id: string;
  denominationCommune: string;
  forme: string | null;
  dosage: string | null;
  classeTherapeutique: string | null;
  medicamentControle: boolean;
  remboursable: boolean;
  statutHomologation: string;
}

const VARIANT_STATUT: Record<
  string,
  'default' | 'secondary' | 'outline' | 'success' | 'muted'
> = {
  PROPOSE: 'secondary',
  HOMOLOGUE: 'success',
  SUSPENDU: 'outline',
  RETIRE: 'muted',
};

function Message({ res }: { res: ResultatReference | null }) {
  if (!res) return null;
  return (
    <p
      className={
        res.ok
          ? 'text-sm text-emerald-700 dark:text-emerald-400'
          : 'text-sm text-destructive'
      }
    >
      {res.ok ? res.message : res.error}
    </p>
  );
}

export function HomologationPanneau({
  kind,
  actes,
  medicaments,
}: {
  kind: 'actes' | 'medicaments';
  actes?: ActeRef[];
  medicaments?: MedicamentRef[];
}) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ResultatReference | null>(null);
  const run = (fn: () => Promise<ResultatReference>) =>
    start(async () => setRes(await fn()));

  const lignes =
    kind === 'actes'
      ? (actes ?? []).map((a) => ({ statut: a.statut, key: a.id, item: a }))
      : (medicaments ?? []).map((m) => ({
          statut: m.statutHomologation,
          key: m.id,
          item: m,
        }));

  const parStatut = (s: string) => lignes.filter((l) => l.statut === s).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        {['PROPOSE', 'HOMOLOGUE', 'SUSPENDU', 'RETIRE'].map((s) => (
          <Badge key={s} variant={VARIANT_STATUT[s]}>
            {s} · {parStatut(s)}
          </Badge>
        ))}
      </div>
      <Message res={res} />

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">
                {kind === 'actes' ? 'Acte' : 'Médicament (DCI)'}
              </th>
              <th className="px-3 py-2 font-medium">
                {kind === 'actes' ? 'Catégorie' : 'Classe / forme'}
              </th>
              <th className="px-3 py-2 font-medium">Statut</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {kind === 'actes' &&
              (actes ?? []).map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="px-3 py-2">
                    <span className="font-medium">{a.libelle}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {a.code}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {a.categorie ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={VARIANT_STATUT[a.statut] ?? 'outline'}>
                      {LIBELLE_STATUT_HOMOLOGATION[a.statut] ?? a.statut}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="flex justify-end gap-2">
                      {a.statut === 'PROPOSE' && (
                        <Button
                          size="xs"
                          disabled={pending}
                          onClick={() => run(() => homologuerActe(a.id))}
                        >
                          Homologuer
                        </Button>
                      )}
                      {a.statut === 'HOMOLOGUE' && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={pending}
                          onClick={() => run(() => suspendreActe(a.id))}
                        >
                          Suspendre
                        </Button>
                      )}
                      {a.statut !== 'RETIRE' && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={pending}
                          onClick={() => run(() => retirerActe(a.id))}
                        >
                          Retirer
                        </Button>
                      )}
                      {(a.statut === 'SUSPENDU' || a.statut === 'RETIRE') && (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => run(() => reproposerActe(a.id))}
                        >
                          Re-proposer
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}

            {kind === 'medicaments' &&
              (medicaments ?? []).map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-2">
                    <span className="font-medium">{m.denominationCommune}</span>
                    {m.medicamentControle && (
                      <Badge variant="outline" className="ml-2">
                        contrôlé
                      </Badge>
                    )}
                    {m.remboursable && (
                      <Badge variant="muted" className="ml-2">
                        remboursable
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {[m.classeTherapeutique, [m.forme, m.dosage].filter(Boolean).join(' ')]
                      .filter(Boolean)
                      .join(' — ') || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={VARIANT_STATUT[m.statutHomologation] ?? 'outline'}
                    >
                      {LIBELLE_STATUT_HOMOLOGATION[m.statutHomologation] ??
                        m.statutHomologation}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="flex justify-end gap-2">
                      {m.statutHomologation === 'PROPOSE' && (
                        <Button
                          size="xs"
                          disabled={pending}
                          onClick={() =>
                            run(() => homologuerMedicament(m.id, true))
                          }
                        >
                          Homologuer
                        </Button>
                      )}
                      {m.statutHomologation === 'HOMOLOGUE' && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={pending}
                          onClick={() => run(() => suspendreMedicament(m.id))}
                        >
                          Suspendre
                        </Button>
                      )}
                      {m.statutHomologation !== 'RETIRE' && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={pending}
                          onClick={() => run(() => retirerMedicament(m.id))}
                        >
                          Retirer
                        </Button>
                      )}
                      {(m.statutHomologation === 'SUSPENDU' ||
                        m.statutHomologation === 'RETIRE') && (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => run(() => reproposerMedicament(m.id))}
                        >
                          Re-proposer
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}

            {lignes.length === 0 && (
              <tr className="border-t">
                <td
                  className="px-3 py-6 text-center text-muted-foreground"
                  colSpan={4}
                >
                  Aucune entrée dans le référentiel.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
