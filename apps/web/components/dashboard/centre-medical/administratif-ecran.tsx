'use client';

import Link from 'next/link';
import { ClipboardList, FileCheck2, ListChecks } from 'lucide-react';

import type { DossierResume } from './dossiers-ecran';
import {
  CarteResume,
  DataTable,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LIBELLE_STATUT_DOSSIER } from '@/lib/dossier-soins';
import {
  LIBELLE_STATUT_ETABLISSEMENT,
  LIBELLE_TYPE_ETABLISSEMENT,
} from '@/lib/reseau';

export interface EtablissementInfo {
  id: string;
  nom: string;
  typeEtablissement: string;
  ville: string | null;
  commune: string | null;
  statut: string;
  gardeWeekend: boolean;
  telephone: string | null;
  email: string | null;
}

const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';

export function AdministratifEcran({
  etablissement,
  dossiers,
}: {
  etablissement: EtablissementInfo;
  dossiers: DossierResume[];
}) {
  const ouverts = dossiers.filter((d) => d.statut === 'OUVERT');
  const clotures = dossiers.filter((d) =>
    ['CLOTURE', 'FORCE_CLOS'].includes(d.statut),
  );

  const colonnes: ColonneTable<DossierResume>[] = [
    { cle: 'numeroTraitement', entete: 'N° traitement', triable: true },
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
    <div className="space-y-8">
      <GrilleCartes>
        <CarteResume
          libelle="Dossiers ouverts"
          valeur={ouverts.length}
          icon={ClipboardList}
          href="/dashboard-centre-medical/medecin"
        />
        <CarteResume
          libelle="Dossiers clôturés"
          valeur={clotures.length}
          icon={FileCheck2}
        />
        <CarteResume
          libelle="Total (établissement)"
          valeur={dossiers.length}
          icon={ListChecks}
        />
      </GrilleCartes>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Votre établissement
        </h2>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">{etablissement.nom}</CardTitle>
            <StatutBadge
              statut={etablissement.statut}
              libelles={LIBELLE_STATUT_ETABLISSEMENT}
            />
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {LIBELLE_TYPE_ETABLISSEMENT[etablissement.typeEtablissement] ??
                etablissement.typeEtablissement}
              {etablissement.ville ? ` — ${etablissement.ville}` : ''}
              {etablissement.commune ? `, ${etablissement.commune}` : ''}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {etablissement.gardeWeekend && (
                <Badge variant="secondary">Garde le week-end</Badge>
              )}
              {etablissement.telephone && (
                <Badge variant="outline">{etablissement.telephone}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Informations gérées par l’assureur (informatique réseau de soins) —
              lecture seule pour ce rôle.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Dossiers de soins de l’établissement
          </h2>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard-centre-medical/medecin">
              Voir les dossiers ouverts
            </Link>
          </Button>
        </div>
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
          vide="Aucun dossier de soins pour l’instant dans votre établissement."
        />
      </section>
    </div>
  );
}
