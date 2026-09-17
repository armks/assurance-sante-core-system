'use client';

import Link from 'next/link';

import {
  DataTable,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

export interface DossierClot {
  id: string;
  numeroTraitement: string;
  statut: string;
  dateCloture: string | null;
}

const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';

export function FacturationEcran({ dossiers }: { dossiers: DossierClot[] }) {
  const colonnes: ColonneTable<DossierClot>[] = [
    { cle: 'numeroTraitement', entete: 'N° traitement', triable: true },
    {
      cle: 'statut',
      entete: 'Dossier',
      rendu: (d) => <StatutBadge statut={d.statut} />,
    },
    {
      cle: 'dateCloture',
      entete: 'Clôturé le',
      triable: true,
      valeur: (d) => d.dateCloture ?? '',
      rendu: (d) => dateFr(d.dateCloture),
    },
  ];

  return (
    <DataTable
      donnees={dossiers}
      cleLigne={(d) => d.id}
      parPage={10}
      recherche={{
        placeholder: 'N° de traitement…',
        champs: ['numeroTraitement'],
      }}
      colonnes={colonnes}
      filtres={[
        {
          cle: 'statut',
          libelle: 'Statut',
          options: [
            { valeur: 'OUVERT', libelle: 'Ouvert' },
            { valeur: 'SUSPENDU', libelle: 'Suspendu' },
            { valeur: 'CLOTURE', libelle: 'Clôturé' },
            { valeur: 'FORCE_CLOS', libelle: 'Clôturé (forcé)' },
          ],
        },
      ]}
      actionLigne={(d) => (
        <Button asChild size="xs" variant="ghost">
          <Link href={`/dashboard-centre-medical/comptable/${d.id}`}>
            Facturation
          </Link>
        </Button>
      )}
      vide="Aucun dossier à facturer."
    />
  );
}
