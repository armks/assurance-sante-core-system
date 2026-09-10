'use client';

import { Activity, Building2, TriangleAlert, Users } from 'lucide-react';

import {
  CarteResume,
  DataTable,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface OrgSante {
  id: string;
  nom: string;
  type: string;
  pays: string;
  statut: string;
  licence: {
    plan: string;
    statut: string;
    dateFin: string | null;
    limiteAdherents: number | null;
  } | null;
  adherentsRattaches: number;
  limiteAdherents: number | null;
  tauxUtilisationAdherents: number | null;
  quotaDepasse: boolean;
  derniereActivite: string | null;
}
export interface SanteSysteme {
  genereLe: string;
  resume: {
    totalOrganisations: number;
    totalAdherentsRattaches: number;
    organisationsQuotaDepasse: number;
    parStatutOrganisation: Record<string, number>;
    parStatutLicence: Record<string, number>;
  };
  organisations: OrgSante[];
}

const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';
const dateTimeFr = (d: string | null) =>
  d
    ? new Date(d).toLocaleString('fr-FR', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : 'aucune';

export function SanteSystemeEcran({ sante }: { sante: SanteSysteme }) {
  const { resume, organisations } = sante;

  const colonnes: ColonneTable<OrgSante>[] = [
    { cle: 'nom', entete: 'Organisation', triable: true },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (o) => <StatutBadge statut={o.statut} />,
    },
    {
      cle: 'licence',
      entete: 'Licence',
      rendu: (o) =>
        o.licence ? (
          <span className="flex items-center gap-1.5">
            <Badge variant="secondary">{o.licence.plan}</Badge>
            <StatutBadge statut={o.licence.statut} />
          </span>
        ) : (
          <Badge variant="outline">sans licence</Badge>
        ),
    },
    {
      cle: 'adherents',
      entete: 'Adhérents / limite',
      aligneDroite: true,
      valeur: (o) => o.adherentsRattaches,
      rendu: (o) => (
        <span className={o.quotaDepasse ? 'font-semibold text-destructive' : ''}>
          {o.adherentsRattaches}
          {' / '}
          {o.limiteAdherents ?? '∞'}
          {o.tauxUtilisationAdherents != null && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({o.tauxUtilisationAdherents} %)
            </span>
          )}
        </span>
      ),
    },
    {
      cle: 'echeance',
      entete: 'Échéance licence',
      valeur: (o) => o.licence?.dateFin ?? '',
      rendu: (o) => dateFr(o.licence?.dateFin ?? null),
    },
    {
      cle: 'derniereActivite',
      entete: 'Dernière activité',
      triable: true,
      valeur: (o) => o.derniereActivite ?? '',
      rendu: (o) => dateTimeFr(o.derniereActivite),
    },
  ];

  return (
    <div className="space-y-6">
      <GrilleCartes>
        <CarteResume
          libelle="Organisations"
          valeur={resume.totalOrganisations}
          icon={Building2}
        />
        <CarteResume
          libelle="Adhérents rattachés"
          valeur={resume.totalAdherentsRattaches}
          icon={Users}
        />
        <CarteResume
          libelle="Quotas dépassés"
          valeur={resume.organisationsQuotaDepasse}
          icon={TriangleAlert}
          tonIndice={resume.organisationsQuotaDepasse > 0 ? 'negatif' : 'neutre'}
        />
        <CarteResume
          libelle="Généré le"
          valeur={
            <span className="text-base font-medium">
              {dateTimeFr(sante.genereLe)}
            </span>
          }
          icon={Activity}
        />
      </GrilleCartes>

      <div className="grid gap-4 sm:grid-cols-2">
        <Repartition titre="Organisations par statut" data={resume.parStatutOrganisation} />
        <Repartition titre="Licences par statut" data={resume.parStatutLicence} />
      </div>

      <DataTable
        donnees={organisations}
        cleLigne={(o) => o.id}
        parPage={15}
        recherche={{ placeholder: 'Organisation…', champs: ['nom', 'pays'] }}
        colonnes={colonnes}
        vide="Aucune organisation."
      />
    </div>
  );
}

function Repartition({
  titre,
  data,
}: {
  titre: string;
  data: Record<string, number>;
}) {
  const entrees = Object.entries(data);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{titre}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {entrees.length === 0 ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          entrees.map(([statut, n]) => (
            <span key={statut} className="flex items-center gap-1.5">
              <StatutBadge statut={statut} />
              <span className="text-sm font-medium tabular-nums">{n}</span>
            </span>
          ))
        )}
      </CardContent>
    </Card>
  );
}
