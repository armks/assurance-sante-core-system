'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { validerCodeDispensation } from '@/app/dashboard-adherent/dispensations/actions';
import {
  DataTable,
  FiltresServeur,
  PaginationServeur,
  StatutBadge,
  type ColonneTable,
  type PageServeur,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

export interface DispensationAdherent {
  id: string;
  pharmacie: string;
  statut: string;
  montantTotal: string;
  montantAssurance: string;
  montantPatient: string;
  code?: string;
  medicaments: string[];
  datePreparation: string;
}

const LIBELLE_STATUT: Record<string, string> = {
  EN_PREPARATION: 'En préparation',
  EN_ATTENTE_VALIDATION_PATIENT: 'En attente de votre validation',
  VALIDEE: 'Validée — réglable en pharmacie',
  PAYEE: 'Payée',
  ANNULEE: 'Annulée',
};

const montant = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;
const dateHeureFr = (d: string) => new Date(d).toLocaleString('fr-FR');

export function DispensationsEcran({
  dispensations,
}: {
  /** Page renvoyée par l'API (pagination, statut et période côté serveur). */
  dispensations: PageServeur<DispensationAdherent>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // Liste paginée CÔTÉ SERVEUR (plus récentes d'abord) : pas de tri local.
  const colonnes: ColonneTable<DispensationAdherent>[] = [
    { cle: 'pharmacie', entete: 'Pharmacie' },
    {
      cle: 'medicaments',
      entete: 'Médicaments',
      rendu: (d) => d.medicaments.join(', ') || '—',
    },
    {
      cle: 'datePreparation',
      entete: 'Préparée le',
      rendu: (d) => dateHeureFr(d.datePreparation),
    },
    {
      cle: 'montantAssurance',
      entete: 'Part assurance',
      aligneDroite: true,
      valeur: (d) => Number(d.montantAssurance),
      rendu: (d) => montant(d.montantAssurance),
    },
    {
      cle: 'montantPatient',
      entete: 'À votre charge',
      aligneDroite: true,
      valeur: (d) => Number(d.montantPatient),
      rendu: (d) => montant(d.montantPatient),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (d) => <StatutBadge statut={d.statut} libelles={LIBELLE_STATUT} />,
    },
    {
      cle: 'code',
      entete: 'Code de confirmation',
      rendu: (d) =>
        d.code ? (
          <span className="font-mono font-semibold">{d.code}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <FiltresServeur
        periode
        libellePeriode="Préparée"
        selects={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: Object.entries(LIBELLE_STATUT).map(([valeur, libelle]) => ({ valeur, libelle })),
          },
        ]}
      />
    <DataTable
      donnees={dispensations.items}
      cleLigne={(d) => d.id}
      parPage={0}
      piedMasque
      colonnes={colonnes}
      actionLigne={(d) =>
        d.code ? (
          <Button
            size="xs"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await validerCodeDispensation(d.code!);
                router.refresh();
              })
            }
          >
            Valider le code
          </Button>
        ) : null
      }
      vide="Aucune dispensation ne correspond à ces critères."
    />
      <PaginationServeur
        page={dispensations.page}
        pages={dispensations.pages}
        total={dispensations.total}
        limite={dispensations.limite}
      />
    </div>
  );
}
