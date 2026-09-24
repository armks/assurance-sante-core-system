'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import {
  CarteResume,
  DataTable,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import {
  LIBELLE_STATUT_RECLAMATION,
  STATUTS_RECLAMATION,
  TON_STATUT_RECLAMATION,
} from '@/lib/reclamations';

export interface ReclamationSociete {
  id: string;
  typeReclamation: string;
  statut: string;
  montant: string;
  codesRejet: string[];
  createdAt: string;
  updatedAt: string;
  adherent: { id: string; nom: string; prenom: string; numeroAdherent: string } | null;
  beneficiaire: { id: string; nom: string; prenom: string } | null;
  remboursement: { montantRembourse: string; decision: string } | null;
}

/** « Conclues/fermées » : statut terminal, `updatedAt` sert de date de
 * conclusion (`reclamations` n'a pas de colonne dédiée — pas demandée). Le
 * reste (« ouvertes ») est encore en cours de traitement. */
const STATUTS_CONCLUS = ['AUTO_ADJUDIQUE', 'REJETE', 'PAYEE'];

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

const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');
const montant = (v: string | null) =>
  v === null || v === '' ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;

export function ReclamationsSocieteEcran({ reclamations }: { reclamations: ReclamationSociete[] }) {
  const ouvertes = reclamations.filter((r) => !STATUTS_CONCLUS.includes(r.statut)).length;
  const conclues = reclamations.length - ouvertes;

  const colonnes: ColonneTable<ReclamationSociete>[] = [
    {
      cle: 'adherent',
      entete: 'Adhérent / bénéficiaire',
      valeur: (r) => (r.beneficiaire ? `${r.beneficiaire.nom} ${r.beneficiaire.prenom}` : `${r.adherent?.nom ?? ''} ${r.adherent?.prenom ?? ''}`),
      rendu: (r) => (
        <div className="text-sm">
          <span className="font-medium">
            {r.beneficiaire ? `${r.beneficiaire.nom} ${r.beneficiaire.prenom}` : `${r.adherent?.nom ?? '—'} ${r.adherent?.prenom ?? ''}`}
          </span>
          {r.beneficiaire && (
            <span className="block text-xs text-muted-foreground">
              Bénéficiaire de {r.adherent?.nom} {r.adherent?.prenom}
            </span>
          )}
        </div>
      ),
    },
    {
      cle: 'typeReclamation',
      entete: 'Type de soin',
      triable: true,
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
        <div className="space-y-1">
          <StatutBadge statut={r.statut} map={TON_STATUT_RECLAMATION} libelles={LIBELLE_STATUT_RECLAMATION} />
          {r.codesRejet.length > 0 && (
            <p className="text-xs text-muted-foreground">{r.codesRejet.join(', ')}</p>
          )}
        </div>
      ),
    },
    {
      cle: 'createdAt',
      entete: "Date d'ouverture",
      triable: true,
      valeur: (r) => r.createdAt,
      rendu: (r) => dateFr(r.createdAt),
    },
    {
      cle: 'conclusion',
      entete: 'Date de conclusion',
      triable: true,
      valeur: (r) => (STATUTS_CONCLUS.includes(r.statut) ? r.updatedAt : ''),
      rendu: (r) => (STATUTS_CONCLUS.includes(r.statut) ? dateFr(r.updatedAt) : '—'),
    },
  ];

  return (
    <div className="space-y-6">
      <GrilleCartes>
        <CarteResume libelle="Total" valeur={reclamations.length} />
        <CarteResume libelle="Ouvertes" valeur={ouvertes} icon={AlertTriangle} />
        <CarteResume libelle="Conclues" valeur={conclues} icon={CheckCircle2} />
      </GrilleCartes>

      <DataTable
        donnees={reclamations}
        cleLigne={(r) => r.id}
        parPage={15}
        recherche={{ placeholder: 'Nom, prénom…', champs: ['adherent.nom', 'adherent.prenom', 'beneficiaire.nom', 'beneficiaire.prenom'] }}
        filtres={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: STATUTS_RECLAMATION.map((s) => ({ valeur: s, libelle: LIBELLE_STATUT_RECLAMATION[s] })),
          },
        ]}
        colonnes={colonnes}
        vide="Aucune réclamation pour l’instant."
      />
    </div>
  );
}
