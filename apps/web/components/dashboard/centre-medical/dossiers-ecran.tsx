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
  patient?: {
    nom: string;
    prenom: string;
    numeroCarte: string | null;
    lien: string;
    societe: string | null;
  } | null;
}

const LIBELLE_LIEN: Record<string, string> = {
  CONJOINT: 'conjoint(e)',
  ENFANT: 'enfant',
  PERE: 'père',
  MERE: 'mère',
  AUTRE: 'bénéficiaire',
};

const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';

export function DossiersEcran({ dossiers }: { dossiers: DossierResume[] }) {
  const colonnes: ColonneTable<DossierResume>[] = [
    { cle: 'numeroTraitement', entete: 'N° traitement', triable: true, className: 'font-mono text-xs' },
    {
      cle: 'patient.nom',
      entete: 'Patient',
      triable: true,
      valeur: (d) => (d.patient ? `${d.patient.nom} ${d.patient.prenom}` : ''),
      rendu: (d) =>
        d.patient ? (
          <span>
            <span className="font-medium">
              {d.patient.prenom} <span className="uppercase">{d.patient.nom}</span>
            </span>
            {d.patient.lien !== 'TITULAIRE' && <span className="text-xs text-muted-foreground"> · {LIBELLE_LIEN[d.patient.lien] ?? d.patient.lien}</span>}
          </span>
        ) : (
          (d.beneficiaireId ? 'Bénéficiaire' : 'Adhérent')
        ),
    },
    {
      cle: 'patient.numeroCarte',
      entete: 'N° de carte',
      className: 'font-mono text-xs',
      rendu: (d) => d.patient?.numeroCarte ?? '—',
    },
    {
      cle: 'patient.societe',
      entete: 'Société',
      triable: true,
      rendu: (d) => d.patient?.societe ?? '—',
    },
    {
      cle: 'motifConsultation',
      entete: 'Motif',
      rendu: (d) => d.motifConsultation ?? '—',
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
      compact
      donnees={dossiers}
      cleLigne={(d) => d.id}
      parPage={10}
      recherche={{
        placeholder: 'Patient, carte, société…',
        champs: ['numeroTraitement', 'motifConsultation', 'patient.nom', 'patient.prenom', 'patient.numeroCarte', 'patient.societe'],
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
