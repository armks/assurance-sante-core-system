'use client';

import {
  DataTable,
  FiltresServeur,
  PaginationServeur,
  StatutBadge,
  type ColonneTable,
  type PageServeur,
} from '@/components/dashboard/patterns';

export interface CodeOrdonnance {
  id: string;
  ordonnanceId: string;
  code: string;
  statut: string;
  dateEmission: string;
  dateExpiration: string;
}

const LIBELLE_STATUT: Record<string, string> = {
  EMIS: 'Émis',
  PRESENTE_PHARMACIE: 'Présenté en pharmacie',
  UTILISE_PARTIEL: 'Délivré partiellement',
  UTILISE_COMPLET: 'Délivré entièrement',
  EXPIRE: 'Expiré',
  ANNULE: 'Annulé',
};

/** Le code n'est affiché que tant qu'il sert encore à quelque chose (avant dispensation). */
const STATUTS_CODE_VISIBLE = ['EMIS', 'PRESENTE_PHARMACIE'];

const dateHeureFr = (d: string) => new Date(d).toLocaleString('fr-FR');

export function OrdonnancesEcran({
  codes,
}: {
  /** Page renvoyée par l'API (pagination, statut et période côté serveur). */
  codes: PageServeur<CodeOrdonnance>;
}) {
  // Liste paginée CÔTÉ SERVEUR (plus récentes d'abord) : pas de tri local.
  const colonnes: ColonneTable<CodeOrdonnance>[] = [
    {
      cle: 'code',
      entete: 'Code de retrait',
      rendu: (c) =>
        STATUTS_CODE_VISIBLE.includes(c.statut) ? (
          <span className="font-mono font-semibold">{c.code}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (c) => <StatutBadge statut={c.statut} libelles={LIBELLE_STATUT} />,
    },
    {
      cle: 'dateEmission',
      entete: 'Émis le',
      rendu: (c) => dateHeureFr(c.dateEmission),
    },
    {
      cle: 'dateExpiration',
      entete: 'Expire le',
      valeur: (c) => c.dateExpiration,
      rendu: (c) => dateHeureFr(c.dateExpiration),
    },
  ];

  return (
    <div className="space-y-3">
      <FiltresServeur
        periode
        libellePeriode="Émise"
        selects={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: Object.entries(LIBELLE_STATUT).map(([valeur, libelle]) => ({ valeur, libelle })),
          },
        ]}
      />
      <DataTable
        donnees={codes.items}
        cleLigne={(c) => c.id}
        parPage={0}
        piedMasque
        colonnes={colonnes}
        vide="Aucune ordonnance ne correspond à ces critères."
      />
      <PaginationServeur page={codes.page} pages={codes.pages} total={codes.total} limite={codes.limite} />
    </div>
  );
}
