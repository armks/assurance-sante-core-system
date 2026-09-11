'use client';

import { DataTable, StatutBadge, type ColonneTable } from '@/components/dashboard/patterns';

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

export function OrdonnancesEcran({ codes }: { codes: CodeOrdonnance[] }) {
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
      triable: true,
      valeur: (c) => c.dateEmission,
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
    <DataTable
      donnees={codes}
      cleLigne={(c) => c.id}
      parPage={10}
      colonnes={colonnes}
      vide="Aucune ordonnance pour l’instant."
    />
  );
}
