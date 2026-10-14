'use client';

import Link from 'next/link';

import {
  DataTable,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { CHAMPS_RECHERCHE_PATIENT, colonnesPatient, type DossierResume } from './dossiers-ecran';
import {
  FILTRE_STATUT_DOSSIER,
  LIBELLE_STATUT_DOSSIER,
} from '@/lib/dossier-soins';

export interface DossierClot {
  id: string;
  numeroTraitement: string;
  statut: string;
  dateCloture: string | null;
  beneficiaireId?: string | null;
  patient?: DossierResume['patient'];
}

const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';

export function FacturationEcran({ dossiers }: { dossiers: DossierClot[] }) {
  const colonnes: ColonneTable<DossierClot>[] = [
    { cle: 'numeroTraitement', entete: 'N° traitement', triable: true, className: 'font-mono text-xs' },
    ...colonnesPatient<DossierClot>(),
    {
      cle: 'statut',
      entete: 'Dossier',
      rendu: (d) => <StatutBadge statut={d.statut} libelles={LIBELLE_STATUT_DOSSIER} />,
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
      compact
      donnees={dossiers}
      cleLigne={(d) => d.id}
      parPage={10}
      recherche={{
        placeholder: 'Patient, carte, société…',
        champs: ['numeroTraitement', ...CHAMPS_RECHERCHE_PATIENT],
      }}
      colonnes={colonnes}
      filtres={[FILTRE_STATUT_DOSSIER]}
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
