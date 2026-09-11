'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { validerFacturation } from '@/app/dashboard-adherent/factures/actions';
import { DataTable, StatutBadge, type ColonneTable } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

export interface FactureAdherent {
  id: string;
  ticketSoinsId: string;
  numeroTraitement: string;
  code: string;
  statut: string;
  codeValideParPatient: boolean;
  montantTotal: string;
  montantAssurance: string;
  montantPatient: string;
}

const LIBELLE_STATUT: Record<string, string> = {
  EMISE: 'Émise',
  EN_VALIDATION: 'En attente de votre validation',
  VALIDEE: 'Validée — réglable',
  REGLEE: 'Réglée',
  CONTESTEE: 'Contestée',
};

const montant = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;

export function FacturesEcran({ factures }: { factures: FactureAdherent[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const colonnes: ColonneTable<FactureAdherent>[] = [
    { cle: 'numeroTraitement', entete: 'Dossier' },
    {
      cle: 'montantTotal',
      entete: 'Montant total',
      aligneDroite: true,
      valeur: (f) => Number(f.montantTotal),
      rendu: (f) => montant(f.montantTotal),
    },
    {
      cle: 'montantPatient',
      entete: 'À votre charge',
      aligneDroite: true,
      valeur: (f) => Number(f.montantPatient),
      rendu: (f) => montant(f.montantPatient),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (f) => <StatutBadge statut={f.statut} libelles={LIBELLE_STATUT} />,
    },
    {
      cle: 'code',
      entete: 'Code de facturation',
      rendu: (f) =>
        f.codeValideParPatient ? (
          <span className="text-muted-foreground">Validé</span>
        ) : (
          <span className="font-mono font-semibold">{f.code}</span>
        ),
    },
  ];

  return (
    <DataTable
      donnees={factures}
      cleLigne={(f) => f.id}
      parPage={10}
      colonnes={colonnes}
      actionLigne={(f) =>
        f.codeValideParPatient ? null : (
          <Button
            size="xs"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await validerFacturation(f.code);
                router.refresh();
              })
            }
          >
            Valider le code
          </Button>
        )
      }
      vide="Aucune facture pour l’instant."
    />
  );
}
