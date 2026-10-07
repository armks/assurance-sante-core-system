'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

import {
  CarteResume,
  DataTable,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import {
  LIBELLE_STATUT_RECLAMATION,
  STATUTS_RECLAMATION,
  TON_STATUT_RECLAMATION,
} from '@/lib/reclamations';

export interface Remboursement {
  montantRembourse: string;
  plafondRestantApres: string | null;
  decision: string;
  dureeTraitementMs: number | null;
}
export interface Reclamation {
  id: string;
  typeReclamation: string;
  montant: string;
  statut: string;
  codesRejet: string[] | null;
  createdAt: string;
  adherentId: string | null;
  beneficiaireId: string | null;
  dossierSoinsId: string;
  remboursement: Remboursement | null;
  /** Rôle de revue manuelle, fourni par l'API depuis le référentiel des
   * catégories d'acte (prisma/sql/067). */
  roleRevue: string;
}

const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';
const montant = (v: string | null) =>
  v === null || v === '' ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;

export function ReclamationsListe({
  reclamations,
}: {
  reclamations: Reclamation[];
}) {
  const parStatut = (s: string) =>
    reclamations.filter((r) => r.statut === s).length;
  const enRevue = parStatut('REVUE_MANUELLE');

  const colonnes: ColonneTable<Reclamation>[] = [
    {
      cle: 'id',
      entete: 'N°',
      rendu: (r) => <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>,
    },
    {
      cle: 'patient',
      entete: 'Patient',
      rendu: (r) => (r.beneficiaireId ? 'Bénéficiaire' : 'Adhérent'),
    },
    {
      cle: 'typeReclamation',
      entete: 'Type',
      triable: true,
      rendu: (r) => r.typeReclamation,
    },
    {
      cle: 'montant',
      entete: 'Montant réclamé',
      aligneDroite: true,
      valeur: (r) => Number(r.montant),
      rendu: (r) => montant(r.montant),
    },
    {
      cle: 'rembourse',
      entete: 'Remboursé',
      aligneDroite: true,
      valeur: (r) => Number(r.remboursement?.montantRembourse ?? 0),
      rendu: (r) => montant(r.remboursement?.montantRembourse ?? null),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (r) => (
        <StatutBadge
          statut={r.statut}
          map={TON_STATUT_RECLAMATION}
          libelles={LIBELLE_STATUT_RECLAMATION}
        />
      ),
    },
    {
      cle: 'codesRejet',
      entete: 'Codes',
      rendu: (r) =>
        r.codesRejet && r.codesRejet.length > 0 ? (
          <span className="font-mono text-xs text-muted-foreground">
            {r.codesRejet.join(', ')}
          </span>
        ) : (
          '—'
        ),
    },
    {
      cle: 'createdAt',
      entete: 'Reçue le',
      triable: true,
      valeur: (r) => r.createdAt,
      rendu: (r) => dateFr(r.createdAt),
    },
  ];

  return (
    <div className="space-y-6">
      <GrilleCartes>
        <CarteResume libelle="Total" valeur={reclamations.length} />
        <CarteResume
          libelle="Auto-adjudiquées"
          valeur={parStatut('AUTO_ADJUDIQUE')}
        />
        <CarteResume
          libelle="En revue manuelle"
          valeur={enRevue}
          icon={AlertTriangle}
          href="/dashboard-assureur/informatique/reclamations/revue-manuelle"
        />
        <CarteResume libelle="Rejetées" valeur={parStatut('REJETE')} />
      </GrilleCartes>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Toutes les réclamations de l’organisation.
        </p>
        <Button asChild size="sm" variant={enRevue > 0 ? 'default' : 'outline'}>
          <Link href="/dashboard-assureur/informatique/reclamations/revue-manuelle">
            File « En revue manuelle » ({enRevue})
          </Link>
        </Button>
      </div>

      <DataTable
        donnees={reclamations}
        cleLigne={(r) => r.id}
        parPage={15}
        recherche={{ placeholder: 'N°, type…', champs: ['id', 'typeReclamation'] }}
        filtres={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: STATUTS_RECLAMATION.map((s) => ({
              valeur: s,
              libelle: LIBELLE_STATUT_RECLAMATION[s],
            })),
          },
        ]}
        colonnes={colonnes}
        actionLigne={(r) => (
          <Button asChild size="xs" variant="ghost">
            <Link
              href={`/dashboard-assureur/informatique/reclamations/${r.id}`}
            >
              Détail
            </Link>
          </Button>
        )}
        vide="Aucune réclamation pour l’instant."
      />
    </div>
  );
}
