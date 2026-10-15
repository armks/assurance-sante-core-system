'use client';

import { Coins, HandCoins, ReceiptText, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import type { RecapDispensations } from '@/app/dashboard-pharmacie/dispensation-types';
import { BlocEtablissementPatient, type EtablissementDetail } from '@/components/dashboard/adherent/bloc-etablissement-patient';
import { FiltresFamille } from '@/components/dashboard/adherent/filtres-famille';
import {
  CarteResume,
  DataTable,
  GrilleCartes,
  PaginationServeur,
  StatutBadge,
  type ColonneTable,
  type PageServeur,
} from '@/components/dashboard/patterns';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export interface CodeOrdonnance {
  id: string;
  ordonnanceId: string;
  code: string;
  statut: string;
  dateEmission: string;
  dateExpiration: string;
  /** Établissement du médecin prescripteur. */
  etablissement?: string | null;
  etablissementDetail?: EtablissementDetail | null;
  patient?: { nom: string; prenom: string; numeroCarte: string | null } | null;
  numeroTraitement?: string | null;
  medicaments?: {
    denomination: string;
    dosage: string | null;
    posologie: string;
    duree: string | null;
    quantite: number;
    statut: string;
  }[];
  montantTotal?: string;
  montantAssurance?: string;
  montantPatient?: string;
}

const LIBELLE_STATUT: Record<string, string> = {
  EMIS: 'Émis',
  PRESENTE_PHARMACIE: 'Présenté en pharmacie',
  UTILISE_PARTIEL: 'Délivré partiellement',
  UTILISE_COMPLET: 'Délivré entièrement',
  EXPIRE: 'Expiré',
  ANNULE: 'Annulé',
};

/** Le code n'est affiché que tant qu'il sert encore à quelque chose (avant dispensation). */
const STATUTS_CODE_VISIBLE = ['EMIS', 'PRESENTE_PHARMACIE'];

const dateHeureFr = (d: string) => new Date(d).toLocaleString('fr-FR');
const montant = (v: string | undefined) => `${Number(v ?? 0).toLocaleString('fr-FR')} F`;

/**
 * « Mes ordonnances » : même présentation que les dispensations (filtres sur une ligne, cumul en tête, établissement
 * prescripteur, patient, coût / part assurance / part assuré), médicaments prescrits au clic sur une ligne.
 */
export function OrdonnancesEcran({
  codes,
  recap = null,
  periode = 'jour',
  cartesFamille = [],
}: {
  /** Page renvoyée par l'API (pagination, statut, période et n° de carte côté serveur). */
  codes: PageServeur<CodeOrdonnance>;
  recap?: RecapDispensations | null;
  periode?: string;
  cartesFamille?: { numeroCarte: string; nom: string }[];
}) {
  const [ouverte, setOuverte] = useState<CodeOrdonnance | null>(null);

  // Liste paginée CÔTÉ SERVEUR (plus récentes d'abord) : pas de tri local.
  const colonnes: ColonneTable<CodeOrdonnance>[] = [
    { cle: 'dateEmission', entete: 'Émise le', rendu: (c) => dateHeureFr(c.dateEmission) },
    { cle: 'etablissement', entete: 'Établissement', rendu: (c) => c.etablissement ?? '—' },
    {
      cle: 'patient',
      entete: 'Patient',
      rendu: (c) =>
        c.patient ? (
          <div className="leading-tight">
            <p className="font-medium">
              {c.patient.prenom} {c.patient.nom}
            </p>
            <p className="font-mono text-xs text-muted-foreground">{c.patient.numeroCarte}</p>
          </div>
        ) : (
          '—'
        ),
    },
    {
      cle: 'code',
      entete: 'Code de retrait',
      rendu: (c) =>
        STATUTS_CODE_VISIBLE.includes(c.statut) ? (
          <span className="font-mono font-semibold">{c.code}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      cle: 'montantTotal',
      entete: 'Coût',
      aligneDroite: true,
      rendu: (c) => <span className="font-semibold">{montant(c.montantTotal)}</span>,
    },
    { cle: 'montantPatient', entete: 'Part assuré', aligneDroite: true, rendu: (c) => montant(c.montantPatient) },
    {
      cle: 'montantAssurance',
      entete: 'Part assurance',
      aligneDroite: true,
      rendu: (c) => <span className="text-emerald-700 dark:text-emerald-400">{montant(c.montantAssurance)}</span>,
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (c) => <StatutBadge statut={c.statut} libelles={LIBELLE_STATUT} />,
    },
  ];

  return (
    <div className="space-y-4">
      <FiltresFamille periode={periode} cartesFamille={cartesFamille} statuts={LIBELLE_STATUT} />

      <GrilleCartes>
        <CarteResume libelle="Ordonnances" valeur={recap?.nombre ?? '—'} icon={ReceiptText} />
        <CarteResume libelle="Coût total" valeur={recap ? montant(recap.montantTotal) : '—'} icon={Coins} />
        <CarteResume libelle="Part assurance" valeur={recap ? montant(recap.montantAssurance) : '—'} icon={ShieldCheck} />
        <CarteResume libelle="Part assuré" valeur={recap ? montant(recap.montantPatient) : '—'} icon={HandCoins} />
      </GrilleCartes>

      <DataTable
        donnees={codes.items}
        cleLigne={(c) => c.id}
        parPage={0}
        piedMasque
        colonnes={colonnes}
        surClicLigne={setOuverte}
        vide="Aucune ordonnance ne correspond à ces critères."
      />
      <PaginationServeur page={codes.page} pages={codes.pages} total={codes.total} limite={codes.limite} />

      <Dialog open={!!ouverte} onOpenChange={(o) => !o && setOuverte(null)}>
        <DialogContent side="center" className="w-auto min-w-[min(92vw,28rem)] max-w-[min(92vw,36rem)]">
          {ouverte && (
            <div className="space-y-3">
              <div>
                <DialogTitle>Ordonnance{ouverte.numeroTraitement ? ` — dossier ${ouverte.numeroTraitement}` : ''}</DialogTitle>
                <DialogDescription>
                  Émise le {dateHeureFr(ouverte.dateEmission)}, expire le {dateHeureFr(ouverte.dateExpiration)}
                </DialogDescription>
              </div>
              <BlocEtablissementPatient
                etablissement={ouverte.etablissementDetail}
                nomEtablissement={ouverte.etablissement}
                patient={ouverte.patient}
              />
              {ouverte.medicaments && ouverte.medicaments.length > 0 ? (
                <ul className="divide-y rounded-md border text-sm">
                  {ouverte.medicaments.map((m, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span>
                        {m.denomination}
                        {m.dosage ? ` ${m.dosage}` : ''} × {m.quantite}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {m.posologie}
                          {m.duree ? ` · ${m.duree}` : ''}
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">{m.statut === 'SERVIE' ? 'Servi' : 'À servir'}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Détail des médicaments non disponible.</p>
              )}
              <dl className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Coût</dt><dd className="font-semibold">{montant(ouverte.montantTotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Part assurance</dt><dd>{montant(ouverte.montantAssurance)}</dd></div>
                <div className="flex justify-between border-t pt-1"><dt className="text-muted-foreground">Part assuré</dt><dd className="font-medium">{montant(ouverte.montantPatient)}</dd></div>
              </dl>
              <div className="flex items-center justify-between text-sm">
                <StatutBadge statut={ouverte.statut} libelles={LIBELLE_STATUT} />
                {STATUTS_CODE_VISIBLE.includes(ouverte.statut) && (
                  <span className="text-muted-foreground">
                    Code de retrait : <span className="font-mono font-semibold text-foreground">{ouverte.code}</span>
                  </span>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
