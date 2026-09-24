'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { validerCodeDispensation } from '@/app/dashboard-adherent/dispensations/actions';
import { DataTable, StatutBadge, type ColonneTable } from '@/components/dashboard/patterns';
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

export function DispensationsEcran({ dispensations }: { dispensations: DispensationAdherent[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const colonnes: ColonneTable<DispensationAdherent>[] = [
    { cle: 'pharmacie', entete: 'Pharmacie', triable: true },
    {
      cle: 'medicaments',
      entete: 'Médicaments',
      rendu: (d) => d.medicaments.join(', ') || '—',
    },
    {
      cle: 'datePreparation',
      entete: 'Préparée le',
      triable: true,
      valeur: (d) => d.datePreparation,
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
    <DataTable
      donnees={dispensations}
      cleLigne={(d) => d.id}
      parPage={10}
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
      vide="Aucune dispensation pour l’instant."
    />
  );
}
