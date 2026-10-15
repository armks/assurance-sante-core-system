'use client';

import { Coins, HandCoins, ReceiptText, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import {
  CarteResume,
  DataTable,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { BlocEtablissementPatient, type EtablissementDetail } from '@/components/dashboard/adherent/bloc-etablissement-patient';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

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
  /** Établissement de santé (ou pharmacie) qui a soumis la demande. */
  etablissement?: string | null;
  numeroTraitement?: string | null;
  etablissementDetail?: EtablissementDetail | null;
  patient?: { nom: string; prenom: string; numeroCarte: string | null } | null;
  /** Remboursé par l'assurance / reste à charge de l'assuré — `null` tant que l'adjudication n'a pas décidé. */
  partAssurance?: string | null;
  partAssure?: string | null;
  /** Répartition prévue (adjudication pas encore décidée). */
  partEstimee?: boolean;
  soins?: { libelle: string; categorie: string; quantite: number; montant: string }[];
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

const montant = (v: string | number | null | undefined) =>
  v === null || v === undefined ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');

/**
 * « Mes réclamations » : cumul en tête (réclamations, part assuré, part assurance, coût total — sur la sélection
 * affichée), tableau avec établissement et n° de carte du patient, détail des soins au clic sur une ligne.
 */
export function ReclamationsEcran({ reclamations }: { reclamations: ReclamationAdherent[] }) {
  const [q, setQ] = useState('');
  const [ouverte, setOuverte] = useState<ReclamationAdherent | null>(null);

  const mot = q.trim().toLowerCase();
  const visibles = mot
    ? reclamations.filter((r) =>
        [r.etablissement, r.patient?.numeroCarte, r.patient?.nom, r.patient?.prenom, r.numeroTraitement]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(mot)),
      )
    : reclamations;

  const somme = (f: (r: ReclamationAdherent) => string | null | undefined) =>
    visibles.reduce((acc, r) => acc + Number(f(r) ?? 0), 0);
  const total = somme((r) => r.montant);
  const assurance = somme((r) => r.partAssurance);
  const assure = somme((r) => r.partAssure);

  const colonnes: ColonneTable<ReclamationAdherent>[] = [
    {
      cle: 'createdAt',
      entete: 'Date',
      triable: true,
      valeur: (r) => r.createdAt,
      rendu: (r) => dateFr(r.createdAt),
    },
    { cle: 'etablissement', entete: 'Établissement', rendu: (r) => r.etablissement ?? '—' },
    {
      cle: 'patient',
      entete: 'Patient',
      rendu: (r) =>
        r.patient ? (
          <div className="leading-tight">
            <p className="font-medium">
              {r.patient.prenom} {r.patient.nom}
            </p>
            <p className="font-mono text-xs text-muted-foreground">{r.patient.numeroCarte}</p>
          </div>
        ) : (
          '—'
        ),
    },
    {
      cle: 'typeReclamation',
      entete: 'Type de soin',
      rendu: (r) => LIBELLE_TYPE[r.typeReclamation] ?? r.typeReclamation,
    },
    {
      cle: 'montant',
      entete: 'Coût',
      aligneDroite: true,
      valeur: (r) => Number(r.montant),
      rendu: (r) => <span className="font-semibold">{montant(r.montant)}</span>,
    },
    {
      cle: 'partAssure',
      entete: 'Part assuré',
      aligneDroite: true,
      valeur: (r) => Number(r.partAssure ?? 0),
      rendu: (r) => (
        <span>
          {montant(r.partAssure)}
          {r.partEstimee && <span className="ml-1 text-xs text-muted-foreground">(estimée)</span>}
        </span>
      ),
    },
    {
      cle: 'partAssurance',
      entete: 'Part assurance',
      aligneDroite: true,
      valeur: (r) => Number(r.partAssurance ?? 0),
      rendu: (r) => (
        <span className="text-emerald-700 dark:text-emerald-400">
          {montant(r.partAssurance)}
          {r.partEstimee && <span className="ml-1 text-xs text-muted-foreground">(estimée)</span>}
        </span>
      ),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (r) => (
        <div className="space-y-1">
          <StatutBadge statut={r.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />
          {r.codesRejet.length > 0 && <p className="text-xs text-muted-foreground">{r.codesRejet.join(', ')}</p>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="N° de carte, patient, établissement, dossier…"
        aria-label="Rechercher une réclamation"
        className="h-9 max-w-md"
      />

      <GrilleCartes>
        <CarteResume libelle="Réclamations" valeur={visibles.length} icon={ReceiptText} />
        <CarteResume libelle="Part assuré" valeur={montant(assure)} icon={HandCoins} />
        <CarteResume libelle="Part assurance" valeur={montant(assurance)} icon={ShieldCheck} />
        <CarteResume libelle="Coût total" valeur={montant(total)} icon={Coins} />
      </GrilleCartes>

      <DataTable
        donnees={visibles}
        cleLigne={(r) => r.id}
        parPage={10}
        colonnes={colonnes}
        surClicLigne={setOuverte}
        vide="Aucune réclamation pour l’instant."
      />

      <Dialog open={!!ouverte} onOpenChange={(o) => !o && setOuverte(null)}>
        <DialogContent side="center" className="w-auto min-w-[min(92vw,28rem)] max-w-[min(92vw,36rem)]">
          {ouverte && (
            <div className="space-y-3">
              <div>
                <DialogTitle>Détail des soins</DialogTitle>
                <DialogDescription>
                  {ouverte.numeroTraitement ? `Dossier ${ouverte.numeroTraitement} · ` : ''}soumis le {dateFr(ouverte.createdAt)}
                </DialogDescription>
              </div>
              <BlocEtablissementPatient etablissement={ouverte.etablissementDetail} nomEtablissement={ouverte.etablissement} patient={ouverte.patient} />
              {ouverte.soins && ouverte.soins.length > 0 ? (
                <ul className="divide-y rounded-md border text-sm">
                  {ouverte.soins.map((s, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span>
                        {s.libelle} × {s.quantite}
                        <span className="ml-2 text-xs text-muted-foreground">{LIBELLE_TYPE[s.categorie] ?? s.categorie}</span>
                      </span>
                      <span className="whitespace-nowrap tabular-nums">{montant(s.montant)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Détail des soins non disponible.</p>
              )}
              <dl className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Coût</dt><dd className="font-semibold">{montant(ouverte.montant)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Part assuré</dt><dd>{montant(ouverte.partAssure)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Part assurance</dt><dd>{montant(ouverte.partAssurance)}{ouverte.partEstimee ? ' (estimée — décision en attente)' : ''}</dd></div>
                {ouverte.remboursement?.plafondRestantApres != null && (
                  <div className="flex justify-between border-t pt-1"><dt className="text-muted-foreground">Plafond restant après</dt><dd>{montant(ouverte.remboursement.plafondRestantApres)}</dd></div>
                )}
              </dl>
              <div className="space-y-1 text-sm">
                <StatutBadge statut={ouverte.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />
                {ouverte.codesRejet.length > 0 && (
                  <p className="text-xs text-muted-foreground">Motif(s) de rejet : {ouverte.codesRejet.join(', ')}</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
