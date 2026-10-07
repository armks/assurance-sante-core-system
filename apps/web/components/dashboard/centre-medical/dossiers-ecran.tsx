'use client';

import Link from 'next/link';

import {
  DataTable,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { LIBELLE_STATUT_DOSSIER } from '@/lib/dossier-soins';

export interface DossierResume {
  id: string;
  numeroTraitement: string;
  statut: string;
  motifConsultation: string | null;
  dateOuverture: string;
  adherentId: string | null;
  beneficiaireId: string | null;
}

const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';

export function DossiersEcran({ dossiers }: { dossiers: DossierResume[] }) {
  const colonnes: ColonneTable<DossierResume>[] = [
    { cle: 'numeroTraitement', entete: 'N° traitement', triable: true },
    {
      cle: 'motifConsultation',
      entete: 'Motif',
      rendu: (d) => d.motifConsultation ?? '—',
    },
    {
      cle: 'patient',
      entete: 'Patient',
      rendu: (d) => (d.beneficiaireId ? 'Bénéficiaire' : 'Adhérent'),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (d) => <StatutBadge statut={d.statut} libelles={LIBELLE_STATUT_DOSSIER} />,
    },
    {
      cle: 'dateOuverture',
      entete: 'Ouvert le',
      triable: true,
      valeur: (d) => d.dateOuverture,
      rendu: (d) => dateFr(d.dateOuverture),
    },
  ];

  return (
    <DataTable
      donnees={dossiers}
      cleLigne={(d) => d.id}
      parPage={10}
      recherche={{
        placeholder: 'N° de traitement, motif…',
        champs: ['numeroTraitement', 'motifConsultation'],
      }}
      colonnes={colonnes}
      actionLigne={(d) => (
        <Button asChild size="xs" variant="ghost">
          <Link href={`/dashboard-centre-medical/medecin/${d.id}`}>Ouvrir</Link>
        </Button>
      )}
      vide="Aucun dossier de soins ouvert dans votre établissement."
    />
  );
}
