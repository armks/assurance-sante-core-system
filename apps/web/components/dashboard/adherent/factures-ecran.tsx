'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { validerFacturation } from '@/app/dashboard-adherent/factures/actions';
import {
  DataTable,
  FiltresServeur,
  PaginationServeur,
  StatutBadge,
  type ColonneTable,
  type PageServeur,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { LIBELLE_STATUT_TARIF_PROPOSE, libelleDe } from '@/lib/tarifs';

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
  createdAt: string;
  /** Actes dont le tarif proposé est en cours d'examen : sortis de cette facture, part estimée INDICATIVE. */
  /** Facture COMPLÉMENTAIRE : part patient d'un acte dont le tarif proposé a été décidé. */
  complementaire?: boolean;
  tarifComplementaire?: {
    acte: string | null;
    statutTarif: string;
    montantRetenu: string | null;
    motifRefus: string | null;
    motifAjustement: string | null;
  } | null;
  actesTarifEnExamen?: {
    acteId: string;
    libelle: string;
    tarifPropose: string | null;
    partEstimeeAssurance: string;
    partEstimeePatient: string;
    mention: string;
  }[];
}

const LIBELLE_STATUT: Record<string, string> = {
  EMISE: 'Émise',
  EN_VALIDATION: 'En attente de votre validation',
  VALIDEE: 'Validée — réglable',
  REGLEE: 'Réglée',
  CONTESTEE: 'Contestée',
};

const montant = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;

export function FacturesEcran({
  factures,
}: {
  /** Page renvoyée par l'API (pagination, statut et période côté serveur). */
  factures: PageServeur<FactureAdherent>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const colonnes: ColonneTable<FactureAdherent>[] = [
    { cle: 'numeroTraitement', entete: 'Dossier' },
    {
      cle: 'createdAt',
      entete: 'Émise le',
      rendu: (f) => new Date(f.createdAt).toLocaleDateString('fr-FR'),
    },
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
      cle: 'tarifEnExamen',
      entete: 'Tarif en cours d’examen',
      rendu: (f) =>
        f.complementaire && f.tarifComplementaire ? (
          <span className="block text-xs" data-testid="facture-complementaire">
            <span className="font-medium">Facture complémentaire</span> — acte « {f.tarifComplementaire.acte ?? '—'} » : tarif{' '}
            {libelleDe(LIBELLE_STATUT_TARIF_PROPOSE, f.tarifComplementaire.statutTarif).toLowerCase()}
            {f.tarifComplementaire.montantRetenu ? `, montant retenu ${montant(f.tarifComplementaire.montantRetenu)}` : ''}
            {f.tarifComplementaire.motifRefus ? `. Motif du refus : ${f.tarifComplementaire.motifRefus}. L’assurance ne prend pas cet acte en charge.` : ''}
            {f.tarifComplementaire.motifAjustement ? `. Motif de l’ajustement : ${f.tarifComplementaire.motifAjustement}` : ''}
          </span>
        ) : f.actesTarifEnExamen && f.actesTarifEnExamen.length > 0 ? (
          <ul className="space-y-1 text-xs" data-testid="actes-tarif-en-examen">
            {f.actesTarifEnExamen.map((a) => (
              <li key={a.acteId}>
                <span className="font-medium">{a.libelle}</span> — {a.mention}. Part estimée (à titre indicatif) :
                assurance {montant(a.partEstimeeAssurance)}, vous {montant(a.partEstimeePatient)}. Cet acte n’est pas
                inclus dans cette facture.
              </li>
            ))}
          </ul>
        ) : (
          '—'
        ),
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
    <div className="space-y-3">
      <FiltresServeur
        periode
        libellePeriode="Émise"
        selects={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: Object.entries(LIBELLE_STATUT).map(([valeur, libelle]) => ({ valeur, libelle })),
          },
        ]}
      />
    <DataTable
      donnees={factures.items}
      cleLigne={(f) => f.id}
      parPage={0}
      piedMasque
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
      vide="Aucune facture ne correspond à ces critères."
    />
      <PaginationServeur page={factures.page} pages={factures.pages} total={factures.total} limite={factures.limite} />
    </div>
  );
}
