'use client';

import { Coins, HandCoins, ReceiptText, ShieldCheck, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { CarteResume, DataTable, GrilleCartes, type ColonneTable } from '@/components/dashboard/patterns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export interface ApercuLigne {
  denominationMedicament: string;
  quantite: number;
  montantLigne: string;
  montantAssurance: string;
  montantPatient: string;
  enLitige: boolean;
}

export interface ApercuDispensation {
  id: string;
  datePaiement: string | null;
  numeroTraitement: string | null;
  patient: { nom: string; prenom: string; numeroCarte: string | null } | null;
  societe: string | null;
  formule: string | null;
  montantTotal: string;
  montantPatient: string;
  montantAssurance: string;
  /** Part assurance hors lignes contestées. */
  montantARegler: string;
  contestee: boolean;
  lignes: ApercuLigne[];
}

export interface ApercuFactureMensuelle {
  periode: string;
  statutFacture: string | null;
  dispensations: ApercuDispensation[];
  totaux: {
    nbDispensations: number;
    nbLignesContestees: number;
    montantTotal: string;
    montantPatient: string;
    montantAssurance: string;
    montantContesteExclu: string;
    montantARegler: string;
  };
}

const montant = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;
const dateFr = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
const moisFr = (d: string) => new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const ORANGE = 'bg-orange-100/70 text-orange-900 hover:bg-orange-100 dark:bg-orange-950/30 dark:text-orange-200 dark:hover:bg-orange-950/40';

/**
 * Aperçu AVANT soumission : les factures de prescription (dispensations payées) du mois, cumul part assuré / part
 * assurance / coût total, et total à régler par l'assurance. Les lignes contestées sont en orange et ne sont pas
 * comptées dans le total à régler.
 */
export function FactureMensuelleApercu({
  apercu,
  mois,
  cible,
}: {
  apercu: ApercuFactureMensuelle;
  /** `precedent` (mois à facturer) ou `courant` (aperçu du mois en cours). */
  mois: 'precedent' | 'courant';
  cible: string;
}) {
  const [ouverte, setOuverte] = useState<ApercuDispensation | null>(null);
  const t = apercu.totaux;

  const colonnes: ColonneTable<ApercuDispensation>[] = [
    { cle: 'datePaiement', entete: 'Payée le', rendu: (d) => dateFr(d.datePaiement) },
    {
      cle: 'patient',
      entete: 'Patient',
      rendu: (d) =>
        d.patient ? (
          <div className="leading-tight">
            <p className="font-medium">
              {d.patient.prenom} {d.patient.nom}
            </p>
            <p className="font-mono text-xs opacity-70">{d.patient.numeroCarte}</p>
          </div>
        ) : (
          '—'
        ),
    },
    { cle: 'societe', entete: 'Société', rendu: (d) => d.societe ?? '—' },
    { cle: 'formule', entete: 'Formule', rendu: (d) => d.formule ?? '—' },
    {
      cle: 'montantTotal',
      entete: 'Coût',
      aligneDroite: true,
      valeur: (d) => Number(d.montantTotal),
      rendu: (d) => montant(d.montantTotal),
    },
    {
      cle: 'montantPatient',
      entete: 'Part assuré',
      aligneDroite: true,
      valeur: (d) => Number(d.montantPatient),
      rendu: (d) => montant(d.montantPatient),
    },
    {
      cle: 'montantAssurance',
      entete: 'Part assurance',
      aligneDroite: true,
      valeur: (d) => Number(d.montantAssurance),
      rendu: (d) => montant(d.montantAssurance),
    },
    {
      cle: 'montantARegler',
      entete: 'À régler par l’assurance',
      aligneDroite: true,
      valeur: (d) => Number(d.montantARegler),
      rendu: (d) => (
        <span className="font-semibold">
          {montant(d.montantARegler)}
          {d.contestee && <span className="ml-1 text-xs font-normal">(contestée)</span>}
        </span>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Factures des prescriptions — {moisFr(apercu.periode)}</CardTitle>
        <nav className="flex gap-1 text-sm" aria-label="Mois affiché">
          <Link
            href={cible}
            scroll={false}
            className={`rounded-md px-2.5 py-1 ${mois === 'precedent' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            Mois à facturer
          </Link>
          <Link
            href={`${cible}?mois=courant`}
            scroll={false}
            className={`rounded-md px-2.5 py-1 ${mois === 'courant' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            Mois en cours (aperçu)
          </Link>
        </nav>
      </CardHeader>
      <CardContent className="space-y-4">
        <GrilleCartes>
          <CarteResume libelle="Part assuré" valeur={montant(t.montantPatient)} icon={HandCoins} />
          <CarteResume libelle="Part assurance" valeur={montant(t.montantAssurance)} icon={ShieldCheck} />
          <CarteResume libelle="Coût total" valeur={montant(t.montantTotal)} icon={Coins} indice={`${t.nbDispensations} facture(s)`} />
          <CarteResume
            libelle="Total à régler par l’assurance"
            valeur={montant(t.montantARegler)}
            icon={ReceiptText}
            indice={t.nbLignesContestees > 0 ? `${montant(t.montantContesteExclu)} contestés exclus` : 'aucune ligne contestée'}
            tonIndice={t.nbLignesContestees > 0 ? 'negatif' : 'neutre'}
          />
        </GrilleCartes>

        {t.nbLignesContestees > 0 && (
          <p className="flex items-center gap-2 rounded-md border border-orange-300 bg-orange-50 p-2 text-sm text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/20 dark:text-orange-200">
            <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
            {t.nbLignesContestees} ligne(s) contestée(s), en orange : elles ne sont pas comptées dans la facture et restent à
            facturer une fois la contestation réglée.
          </p>
        )}
        {apercu.statutFacture && apercu.statutFacture !== 'EN_PREPARATION' && (
          <p className="text-sm text-muted-foreground">Cette facture est déjà soumise : le détail ci-dessous est celui de la facture.</p>
        )}

        <DataTable
          donnees={apercu.dispensations}
          cleLigne={(d) => d.id}
          parPage={15}
          colonnes={colonnes}
          classeLigne={(d) => (d.contestee ? ORANGE : undefined)}
          surClicLigne={setOuverte}
          recherche={{ placeholder: 'Patient, carte, société…', champs: ['patient.nom', 'patient.prenom', 'patient.numeroCarte', 'societe', 'formule'] }}
          vide="Aucune prescription payée pour ce mois."
        />
      </CardContent>

      <Dialog open={!!ouverte} onOpenChange={(o) => !o && setOuverte(null)}>
        <DialogContent side="center" className="w-auto min-w-[min(92vw,28rem)] max-w-[min(92vw,36rem)]">
          {ouverte && (
            <div className="space-y-3">
              <div>
                <DialogTitle>Prescription {ouverte.numeroTraitement ?? ''}</DialogTitle>
                <DialogDescription>
                  {ouverte.patient ? `${ouverte.patient.prenom} ${ouverte.patient.nom} (${ouverte.patient.numeroCarte})` : '—'} · payée le{' '}
                  {dateFr(ouverte.datePaiement)}
                </DialogDescription>
              </div>
              <ul className="divide-y rounded-md border text-sm">
                {ouverte.lignes.map((l, i) => (
                  <li key={i} className={`flex items-center justify-between gap-3 px-3 py-1.5 ${l.enLitige ? ORANGE : ''}`}>
                    <span>
                      {l.denominationMedicament} × {l.quantite}
                      {l.enLitige && <span className="ml-2 text-xs font-medium">(contestée — non facturée)</span>}
                    </span>
                    <span className="whitespace-nowrap tabular-nums">{montant(l.montantLigne)}</span>
                  </li>
                ))}
              </ul>
              <dl className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Coût</dt><dd>{montant(ouverte.montantTotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Part assuré</dt><dd>{montant(ouverte.montantPatient)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Part assurance</dt><dd>{montant(ouverte.montantAssurance)}</dd></div>
                <div className="flex justify-between border-t pt-1 font-semibold"><dt>À régler par l’assurance</dt><dd>{montant(ouverte.montantARegler)}</dd></div>
              </dl>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
