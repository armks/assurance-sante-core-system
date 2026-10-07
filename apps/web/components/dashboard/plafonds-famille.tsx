'use client';

import { Gauge } from 'lucide-react';

import { useCategoriesActe } from '@/components/categories-acte';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LIBELLE_PERIODE_CUMUL, dateCourte, type PeriodeCumulPlafond } from '@/lib/plafonds';

/** Réponse de `GET /api/v1/member/adherents/:id/plafonds` (calcul du microservice). */
export interface PlafondsFamille {
  periode: { mode: PeriodeCumulPlafond; debut: string; fin: string } | null;
  garanties: {
    garantieId: string;
    categorieActe: string;
    plafondPersonne: number | null;
    plafondFamille: number | null;
    consommeFamille: number | null;
    restantFamille: number | null;
    personnes: {
      type: 'TITULAIRE' | 'BENEFICIAIRE';
      id: string;
      nom: string;
      prenom: string;
      consomme: number;
      restant: number | null;
    }[];
  }[];
}

const montant = (v: number) => `${Number(v).toLocaleString('fr-FR')} F`;

/** Jauge « consommé / plafond » (texte lisible ; la barre est décorative). */
function Jauge({ consomme, plafond }: { consomme: number; plafond: number }) {
  const pct = plafond > 0 ? Math.min(100, Math.round((consomme / plafond) * 100)) : 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div
        className={pct >= 100 ? 'h-full bg-destructive' : pct >= 80 ? 'h-full bg-amber-500' : 'h-full bg-primary'}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Plafonds annuels restants d'une famille, par garantie : pour la famille entière
 * et pour chaque personne. Partagé par le tableau de bord adhérent et la fiche
 * adhérent côté société (prisma/sql/069, ADR-006).
 */
export function PlafondsFamilleCarte({
  plafonds,
  erreur,
  titre = 'Plafonds annuels restants',
}: {
  plafonds: PlafondsFamille | null;
  erreur?: string | null;
  titre?: string;
}) {
  const { libelle } = useCategoriesActe();

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="size-4" />
          {titre}
        </CardTitle>
        {plafonds?.periode && (
          <p className="text-sm text-muted-foreground">
            Du {dateCourte(plafonds.periode.debut)} au {dateCourte(plafonds.periode.fin)} —{' '}
            {LIBELLE_PERIODE_CUMUL[plafonds.periode.mode].toLowerCase()}. Les montants repartent à
            zéro à la période suivante.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {erreur ? (
          <p className="text-sm text-destructive">{erreur}</p>
        ) : !plafonds || plafonds.garanties.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune garantie de ce contrat n’a de plafond annuel.
          </p>
        ) : (
          plafonds.garanties.map((g) => (
            <section key={g.garantieId} className="space-y-2">
              <h3 className="text-sm font-medium">{libelle(g.categorieActe)}</h3>

              {g.plafondFamille !== null && g.restantFamille !== null && (
                <div className="space-y-1 rounded-md border p-2.5">
                  <p className="flex flex-wrap justify-between gap-x-3 text-sm">
                    <span>Famille (titulaire et bénéficiaires)</span>
                    <span className="font-medium tabular-nums">
                      {montant(g.restantFamille)} restants sur {montant(g.plafondFamille)}
                    </span>
                  </p>
                  <Jauge consomme={g.consommeFamille ?? 0} plafond={g.plafondFamille} />
                </div>
              )}

              {/* Défilement horizontal propre au tableau sur petit écran */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[22rem] text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">Personne</th>
                      <th className="py-1 pr-3 text-right font-medium">Pris en charge</th>
                      <th className="py-1 text-right font-medium">
                        Restant{g.plafondPersonne !== null ? ` (sur ${montant(g.plafondPersonne)})` : ''}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.personnes.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="py-1.5 pr-3">
                          {p.prenom} {p.nom}
                          {p.type === 'TITULAIRE' && (
                            <span className="ml-1 text-xs text-muted-foreground">(titulaire)</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{montant(p.consomme)}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {p.restant === null ? (
                            <span className="text-muted-foreground">sans plafond individuel</span>
                          ) : (
                            <span className={p.restant <= 0 ? 'font-medium text-destructive' : ''}>
                              {montant(p.restant)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
}
