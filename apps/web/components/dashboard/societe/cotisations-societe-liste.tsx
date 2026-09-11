'use client';

import { AlertTriangle, CheckCircle2, Coins } from 'lucide-react';

import {
  CarteResume,
  DataTable,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';

export interface CotisationSociete {
  id: string;
  periode: string;
  montantDu: string;
  montantPaye: string;
  penaliteAppliquee: string;
  dateEcheance: string;
  statut: string;
  police: {
    numeroPolice: string;
    produit: { nom: string } | null;
  } | null;
}

const LIBELLE_STATUT: Record<string, string> = {
  A_PAYER: 'À payer',
  PAYEE: 'Payée',
  EN_RETARD: 'En retard',
  ANNULEE: 'Annulée',
};
const TON_STATUT: Record<
  string,
  'succes' | 'attention' | 'danger' | 'neutre'
> = {
  A_PAYER: 'attention',
  PAYEE: 'succes',
  EN_RETARD: 'danger',
  ANNULEE: 'neutre',
};

const montant = (v: string | null) =>
  v === null || v === '' ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;
const periodeFr = (d: string) => {
  const [y, m] = d.slice(0, 7).split('-');
  return `${m}/${y}`;
};
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');

export function CotisationsSocieteListe({
  cotisations,
}: {
  cotisations: CotisationSociete[];
}) {
  const parStatut = (s: string) => cotisations.filter((c) => c.statut === s).length;
  const resteAPayer = cotisations
    .filter((c) => c.statut !== 'ANNULEE')
    .reduce((s, c) => s + Number(c.montantDu) - Number(c.montantPaye), 0);

  const colonnes: ColonneTable<CotisationSociete>[] = [
    {
      cle: 'police',
      entete: 'Police',
      valeur: (c) => c.police?.numeroPolice ?? '',
      rendu: (c) => c.police?.numeroPolice ?? '—',
    },
    {
      cle: 'produit',
      entete: 'Produit',
      valeur: (c) => c.police?.produit?.nom ?? '',
      rendu: (c) => c.police?.produit?.nom ?? '—',
    },
    {
      cle: 'periode',
      entete: 'Période',
      triable: true,
      valeur: (c) => c.periode,
      rendu: (c) => periodeFr(c.periode),
    },
    {
      cle: 'montantDu',
      entete: 'Montant dû',
      aligneDroite: true,
      valeur: (c) => Number(c.montantDu),
      rendu: (c) => montant(c.montantDu),
    },
    {
      cle: 'montantPaye',
      entete: 'Montant payé',
      aligneDroite: true,
      valeur: (c) => Number(c.montantPaye),
      rendu: (c) => montant(c.montantPaye),
    },
    {
      cle: 'dateEcheance',
      entete: 'Échéance',
      triable: true,
      valeur: (c) => c.dateEcheance,
      rendu: (c) => dateFr(c.dateEcheance),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (c) => (
        <StatutBadge statut={c.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <GrilleCartes>
        <CarteResume libelle="Cotisations" valeur={cotisations.length} icon={Coins} />
        <CarteResume
          libelle="Reste à payer"
          valeur={montant(resteAPayer.toFixed(2))}
        />
        <CarteResume
          libelle="En retard"
          valeur={parStatut('EN_RETARD')}
          icon={AlertTriangle}
          tonIndice={parStatut('EN_RETARD') > 0 ? 'negatif' : 'neutre'}
        />
        <CarteResume libelle="Payées" valeur={parStatut('PAYEE')} icon={CheckCircle2} />
      </GrilleCartes>

      <p className="text-sm text-muted-foreground">
        Lecture seule — la confirmation de paiement est enregistrée par le
        service comptable de l’assureur.
      </p>

      <DataTable
        donnees={cotisations}
        cleLigne={(c) => c.id}
        parPage={15}
        recherche={{ placeholder: 'N° police, produit…', champs: ['police.numeroPolice', 'police.produit.nom'] }}
        filtres={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: Object.entries(LIBELLE_STATUT).map(([valeur, libelle]) => ({
              valeur,
              libelle,
            })),
          },
        ]}
        colonnes={colonnes}
        vide="Aucune cotisation pour l’instant."
      />
    </div>
  );
}
