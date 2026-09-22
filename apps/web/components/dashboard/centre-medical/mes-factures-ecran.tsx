'use client';

import {
  DataTable,
  StatutBadge,
  type ColonneTable,
  type FiltreSelect,
} from '@/components/dashboard/patterns';

export interface FactureDossierEtablissement {
  id: string;
  numeroTraitement: string;
  societeCliente: string;
  patient: string;
  statut: string;
  montantTotal: string;
  montantAssurance: string;
  montantPatient: string;
  createdAt: string;
  dateReglement: string | null;
}

const LIBELLE_STATUT: Record<string, string> = {
  EMISE: 'Émise — en attente du patient',
  EN_VALIDATION: 'En validation',
  VALIDEE: 'Validée par le patient',
  REGLEE: 'Réglée',
  CONTESTEE: 'Contestée',
};
const TON_STATUT: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  EMISE: 'attention',
  EN_VALIDATION: 'attention',
  VALIDEE: 'attention',
  REGLEE: 'succes',
  CONTESTEE: 'danger',
};

const montant = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');
const periodeCle = (d: string) => d.slice(0, 7); // 'YYYY-MM'
const periodeLibelle = (cle: string) =>
  new Date(`${cle}-01T00:00:00Z`).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

function optionsUniques(valeurs: string[]): { valeur: string; libelle: string }[] {
  return [...new Set(valeurs)]
    .sort((a, b) => a.localeCompare(b, 'fr'))
    .map((v) => ({ valeur: v, libelle: v }));
}

export function MesFacturesEcran({ factures }: { factures: FactureDossierEtablissement[] }) {
  const colonnes: ColonneTable<FactureDossierEtablissement>[] = [
    { cle: 'numeroTraitement', entete: 'Dossier', triable: true },
    { cle: 'societeCliente', entete: 'Société cliente', triable: true },
    { cle: 'patient', entete: 'Adhérent / bénéficiaire', triable: true },
    {
      cle: 'montantTotal',
      entete: 'Montant',
      aligneDroite: true,
      valeur: (f) => Number(f.montantTotal),
      rendu: (f) => montant(f.montantTotal),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (f) => <StatutBadge statut={f.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />,
    },
    {
      cle: 'createdAt',
      entete: 'Émise le',
      triable: true,
      valeur: (f) => f.createdAt,
      rendu: (f) => dateFr(f.createdAt),
    },
    {
      cle: 'dateReglement',
      entete: 'Réglée le',
      triable: true,
      valeur: (f) => f.dateReglement ?? '',
      rendu: (f) => (f.dateReglement ? dateFr(f.dateReglement) : '—'),
    },
  ];

  const filtres: FiltreSelect[] = [
    {
      cle: 'societeCliente',
      libelle: 'Société cliente',
      options: optionsUniques(factures.map((f) => f.societeCliente)),
    },
    {
      cle: 'patient',
      libelle: 'Adhérent / famille',
      options: optionsUniques(factures.map((f) => f.patient)),
    },
    {
      cle: 'statut',
      libelle: 'Statut',
      options: optionsUniques(factures.map((f) => f.statut)).map((o) => ({
        ...o,
        libelle: LIBELLE_STATUT[o.valeur] ?? o.libelle,
      })),
    },
    {
      cle: 'periode',
      libelle: 'Période',
      valeur: (row) => periodeCle((row as FactureDossierEtablissement).createdAt),
      options: optionsUniques(factures.map((f) => periodeCle(f.createdAt))).map((o) => ({
        valeur: o.valeur,
        libelle: periodeLibelle(o.valeur),
      })),
    },
  ];

  return (
    <DataTable
      donnees={factures}
      cleLigne={(f) => f.id}
      parPage={15}
      recherche={{
        placeholder: 'Dossier, société, adhérent…',
        champs: ['numeroTraitement', 'societeCliente', 'patient'],
      }}
      filtres={filtres}
      colonnes={colonnes}
      vide="Aucune facture pour l’instant."
    />
  );
}
