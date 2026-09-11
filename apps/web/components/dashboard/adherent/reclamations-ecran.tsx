'use client';

import { DataTable, StatutBadge, type ColonneTable } from '@/components/dashboard/patterns';

export interface ReclamationAdherent {
  id: string;
  typeReclamation: string;
  statut: string;
  montant: string;
  codesRejet: string[];
  createdAt: string;
  remboursement: {
    montantRembourse: string;
    decision: string;
    plafondRestantApres: string | null;
  } | null;
}

const LIBELLE_STATUT: Record<string, string> = {
  SOUMISE: 'Soumise',
  EN_ADJUDICATION: 'En cours d’analyse',
  AUTO_ADJUDIQUE: 'Approuvée',
  REVUE_MANUELLE: 'En revue',
  REJETE: 'Rejetée',
  PAYEE: 'Payée',
};
const TON_STATUT: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  SOUMISE: 'attention',
  EN_ADJUDICATION: 'attention',
  AUTO_ADJUDIQUE: 'succes',
  REVUE_MANUELLE: 'attention',
  REJETE: 'danger',
  PAYEE: 'succes',
};

const LIBELLE_TYPE: Record<string, string> = {
  SOIN: 'Consultation',
  PHARMACIE: 'Pharmacie',
  HOSPITALISATION: 'Hospitalisation',
  OPTIQUE: 'Optique',
  DENTAIRE: 'Dentaire',
  ANALYSES: 'Analyses',
  IMAGERIE: 'Imagerie',
  AUTRE: 'Autre',
};

const montant = (v: string | null) =>
  v === null ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');

export function ReclamationsEcran({ reclamations }: { reclamations: ReclamationAdherent[] }) {
  const colonnes: ColonneTable<ReclamationAdherent>[] = [
    {
      cle: 'createdAt',
      entete: 'Date',
      triable: true,
      valeur: (r) => r.createdAt,
      rendu: (r) => dateFr(r.createdAt),
    },
    {
      cle: 'typeReclamation',
      entete: 'Type de soin',
      rendu: (r) => LIBELLE_TYPE[r.typeReclamation] ?? r.typeReclamation,
    },
    {
      cle: 'montant',
      entete: 'Montant',
      aligneDroite: true,
      valeur: (r) => Number(r.montant),
      rendu: (r) => montant(r.montant),
    },
    {
      cle: 'remboursement',
      entete: 'Remboursé',
      aligneDroite: true,
      valeur: (r) => Number(r.remboursement?.montantRembourse ?? 0),
      rendu: (r) => montant(r.remboursement?.montantRembourse ?? null),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (r) => (
        <div className="space-y-1">
          <StatutBadge statut={r.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />
          {r.codesRejet.length > 0 && (
            <p className="text-xs text-muted-foreground">{r.codesRejet.join(', ')}</p>
          )}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      donnees={reclamations}
      cleLigne={(r) => r.id}
      parPage={10}
      colonnes={colonnes}
      vide="Aucune réclamation pour l’instant."
    />
  );
}
