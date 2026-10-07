'use client';

import Link from 'next/link';
import { AlertTriangle, FileText, Users } from 'lucide-react';

import {
  CarteResume,
  DataTable,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LIBELLE_POLICE, TON_POLICE } from '@/lib/police';

export interface Garantie {
  id: string;
  categorieActe: string;
  tauxCouverture: string | number | null;
  plafondParActe: string | number | null;
  plafondAnnuel: string | number | null;
  franchise: string | number | null;
  ticketModerateur: string | number | null;
  delaiCarenceJours: number | null;
  reseauSoins: string;
}

export interface ProduitAvecGaranties {
  id: string;
  nom: string;
  version: number;
  statut: string;
  garanties: Garantie[];
}

export interface PoliceAssuree {
  id: string;
  numeroPolice: string;
  produitId: string;
  statut: string;
  dateDebut: string | null;
  dateFin: string | null;
  produit: { nom: string; version: number } | null;
}

export interface CotisationAssuree {
  id: string;
  periode: string;
  montantDu: string;
  montantPaye: string;
  dateEcheance: string;
  statut: string;
}

const LIBELLE_STATUT_COTIS: Record<string, string> = {
  A_PAYER: 'À payer',
  PAYEE: 'Payée',
  EN_RETARD: 'En retard',
  ANNULEE: 'Annulée',
};
const TON_STATUT_COTIS: Record<
  string,
  'succes' | 'attention' | 'danger' | 'neutre'
> = {
  A_PAYER: 'attention',
  PAYEE: 'succes',
  EN_RETARD: 'danger',
  ANNULEE: 'neutre',
};

const montant = (v: string | number | null) =>
  v === null || v === '' ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;
const pourcent = (v: string | number | null) =>
  v === null || v === '' ? '—' : `${Number(v)} %`;
const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';
const periodeFr = (d: string) => {
  const [y, m] = d.slice(0, 7).split('-');
  return `${m}/${y}`;
};

const ADHERENTS_HREF = '/dashboard-societe/administration/adherents';

export function AssureeEcran({
  polices,
  garanties,
  cotisations,
}: {
  polices: PoliceAssuree[];
  /** Garanties du produit, indexées par `produitId`. */
  garanties: Record<string, ProduitAvecGaranties>;
  cotisations: CotisationAssuree[];
}) {
  const policeActive = polices.find((p) => p.statut === 'ACTIVE') ?? polices[0];
  const enRetard = cotisations.filter((c) => c.statut === 'EN_RETARD');
  const resteAPayer = cotisations
    .filter((c) => c.statut !== 'ANNULEE')
    .reduce((s, c) => s + Number(c.montantDu) - Number(c.montantPaye), 0);

  const colCotis: ColonneTable<CotisationAssuree>[] = [
    {
      cle: 'periode',
      entete: 'Période',
      triable: true,
      valeur: (c) => c.periode,
      rendu: (c) => periodeFr(c.periode),
    },
    {
      cle: 'montantDu',
      entete: 'Montant dû',
      aligneDroite: true,
      valeur: (c) => Number(c.montantDu),
      rendu: (c) => montant(c.montantDu),
    },
    {
      cle: 'montantPaye',
      entete: 'Montant payé',
      aligneDroite: true,
      valeur: (c) => Number(c.montantPaye),
      rendu: (c) => montant(c.montantPaye),
    },
    {
      cle: 'dateEcheance',
      entete: 'Échéance',
      triable: true,
      valeur: (c) => c.dateEcheance,
      rendu: (c) => dateFr(c.dateEcheance),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (c) => (
        <StatutBadge
          statut={c.statut}
          map={TON_STATUT_COTIS}
          libelles={LIBELLE_STATUT_COTIS}
        />
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <GrilleCartes>
        <CarteResume
          libelle="Statut du contrat"
          valeur={
            policeActive ? (
              <StatutBadge
                statut={policeActive.statut}
                map={TON_POLICE}
                libelles={LIBELLE_POLICE}
              />
            ) : (
              '—'
            )
          }
          icon={FileText}
        />
        <CarteResume libelle="Reste à payer" valeur={montant(resteAPayer)} />
        <CarteResume
          libelle="Cotisations en retard"
          valeur={enRetard.length}
          icon={AlertTriangle}
          tonIndice={enRetard.length > 0 ? 'negatif' : 'neutre'}
        />
        <CarteResume
          libelle="Adhérents"
          valeur="Gérer"
          icon={Users}
          href={ADHERENTS_HREF}
        />
      </GrilleCartes>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Votre police
        </h2>
        {polices.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Aucune police active pour l’instant.
          </p>
        )}
        {polices.map((p) => {
          const produit = garanties[p.produitId];
          return (
            <Card key={p.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">{p.numeroPolice}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {p.produit?.nom ?? produit?.nom ?? '—'}
                    {p.produit?.version ? ` · v${p.produit.version}` : ''} —{' '}
                    {dateFr(p.dateDebut)} → {dateFr(p.dateFin)}
                  </p>
                </div>
                <StatutBadge
                  statut={p.statut}
                  map={TON_POLICE}
                  libelles={LIBELLE_POLICE}
                />
              </CardHeader>
              <CardContent>
                {produit && produit.garanties.length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Garantie</th>
                          <th className="px-3 py-2 font-medium text-right">Taux</th>
                          <th className="px-3 py-2 font-medium text-right">
                            Plafond / acte
                          </th>
                          <th className="px-3 py-2 font-medium text-right">
                            Plafond / an
                          </th>
                          <th className="px-3 py-2 font-medium text-right">
                            Franchise
                          </th>
                          <th className="px-3 py-2 font-medium">Réseau</th>
                        </tr>
                      </thead>
                      <tbody>
                        {produit.garanties.map((g) => (
                          <tr key={g.id} className="border-t">
                            <td className="px-3 py-2">
                              {g.categorieActe.replaceAll('_', ' ').toLowerCase()}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {pourcent(g.tauxCouverture)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {montant(g.plafondParActe)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {montant(g.plafondAnnuel)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {montant(g.franchise)}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {g.reseauSoins === 'TOUT_RESEAU'
                                ? 'Tout réseau'
                                : 'Conventionné seul'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="border-t bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      Plafonds contractuels des garanties souscrites. Le suivi de
                      leur consommation par sinistre n’est pas encore exposé sur
                      ce tableau de bord.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Garanties non disponibles.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Cotisations
          </h2>
          <Button asChild size="sm" variant="outline">
            <Link href={ADHERENTS_HREF}>Gérer les adhérents</Link>
          </Button>
        </div>
        <DataTable
          donnees={cotisations}
          cleLigne={(c) => c.id}
          parPage={12}
          colonnes={colCotis}
          vide="Aucune cotisation pour l’instant."
        />
      </section>
    </div>
  );
}
