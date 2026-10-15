'use client';

import { Coins, HandCoins, ReceiptText, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { validerFacturation } from '@/app/dashboard-adherent/factures/actions';
import type { RecapDispensations } from '@/app/dashboard-pharmacie/dispensation-types';
import {
  CarteResume,
  DataTable,
  GrilleCartes,
  PaginationServeur,
  StatutBadge,
  type ColonneTable,
  type PageServeur,
} from '@/components/dashboard/patterns';
import { BlocEtablissementPatient, type EtablissementDetail } from '@/components/dashboard/adherent/bloc-etablissement-patient';
import { FiltresFamille } from '@/components/dashboard/adherent/filtres-famille';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { LIBELLE_STATUT_TARIF_PROPOSE, libelleDe } from '@/lib/tarifs';

export interface FactureAdherent {
  id: string;
  patient?: { nom: string; prenom: string; numeroCarte: string | null } | null;
  /** Établissement sanitaire qui a émis la facture. */
  etablissement?: string | null;
  etablissementDetail?: EtablissementDetail | null;
  ticketSoinsId: string;
  numeroTraitement: string;
  code: string;
  statut: string;
  codeValideParPatient: boolean;
  montantTotal: string;
  montantAssurance: string;
  montantPatient: string;
  createdAt: string;
  /** Facture COMPLÉMENTAIRE : part patient d'un acte dont le tarif proposé a été décidé. */
  complementaire?: boolean;
  tarifComplementaire?: {
    acte: string | null;
    statutTarif: string;
    montantRetenu: string | null;
    motifRefus: string | null;
    motifAjustement: string | null;
  } | null;
  /** Actes dont le tarif proposé est en cours d'examen : sortis de cette facture, part estimée INDICATIVE. */
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
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');

/**
 * « Mes factures » : même présentation que les factures de prescription de la pharmacie (filtres sur une ligne,
 * cumul en tête, tableau coût / part assurance / part assuré, détail au clic), avec la recherche par n° de carte du
 * titulaire ou d'un bénéficiaire et la période jour / semaine / mois / entre deux dates.
 */
export function FacturesEcran({
  factures,
  recap = null,
  periode,
  cartesFamille = [],
}: {
  /** Page renvoyée par l'API (pagination, filtres côté serveur). */
  factures: PageServeur<FactureAdherent>;
  recap?: RecapDispensations | null;
  /** Période effective (jour par défaut). */
  periode: string;
  /** N° de carte du titulaire et des bénéficiaires (suggestions du champ de recherche). */
  cartesFamille?: { numeroCarte: string; nom: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ouverte, setOuverte] = useState<FactureAdherent | null>(null);

  const colonnes: ColonneTable<FactureAdherent>[] = [
    { cle: 'createdAt', entete: 'Émise le', rendu: (f) => dateFr(f.createdAt) },
    { cle: 'etablissement', entete: 'Établissement', rendu: (f) => f.etablissement ?? '—' },
    {
      cle: 'patient',
      entete: 'Bénéficiaire',
      rendu: (f) =>
        f.patient ? (
          <div className="leading-tight">
            <p className="font-medium">
              {f.patient.prenom} {f.patient.nom}
            </p>
            <p className="font-mono text-xs text-muted-foreground">{f.patient.numeroCarte}</p>
          </div>
        ) : (
          '—'
        ),
    },
    { cle: 'numeroTraitement', entete: 'Dossier' },
    {
      cle: 'montantTotal',
      entete: 'Coût',
      aligneDroite: true,
      valeur: (f) => Number(f.montantTotal),
      rendu: (f) => <span className="font-semibold">{montant(f.montantTotal)}</span>,
    },
    {
      cle: 'montantAssurance',
      entete: 'Part assurance',
      aligneDroite: true,
      valeur: (f) => Number(f.montantAssurance),
      rendu: (f) => <span className="text-emerald-700 dark:text-emerald-400">{montant(f.montantAssurance)}</span>,
    },
    {
      cle: 'montantPatient',
      entete: 'Part assuré',
      aligneDroite: true,
      valeur: (f) => Number(f.montantPatient),
      rendu: (f) => montant(f.montantPatient),
    },
    { cle: 'statut', entete: 'Statut', rendu: (f) => <StatutBadge statut={f.statut} libelles={LIBELLE_STATUT} /> },
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
    {
      cle: 'actions',
      entete: '',
      rendu: (f) =>
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
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <FiltresFamille periode={periode} cartesFamille={cartesFamille} statuts={LIBELLE_STATUT} />

      <GrilleCartes>
        <CarteResume libelle="Factures" valeur={recap?.nombre ?? '—'} icon={ReceiptText} />
        <CarteResume libelle="Coût total" valeur={recap ? montant(recap.montantTotal) : '—'} icon={Coins} />
        <CarteResume libelle="Part assurance" valeur={recap ? montant(recap.montantAssurance) : '—'} icon={ShieldCheck} />
        <CarteResume libelle="Part assuré" valeur={recap ? montant(recap.montantPatient) : '—'} icon={HandCoins} />
      </GrilleCartes>

      <DataTable
        donnees={factures.items}
        cleLigne={(f) => f.id}
        parPage={0}
        piedMasque
        colonnes={colonnes}
        surClicLigne={setOuverte}
        vide="Aucune facture ne correspond à ces critères."
      />
      <PaginationServeur page={factures.page} pages={factures.pages} total={factures.total} limite={factures.limite} />

      <Dialog open={!!ouverte} onOpenChange={(o) => !o && setOuverte(null)}>
        <DialogContent side="center" className="w-auto min-w-[min(92vw,28rem)] max-w-[min(92vw,36rem)]">
          {ouverte && (
            <div className="space-y-3">
              <div>
                <DialogTitle>Facture du dossier {ouverte.numeroTraitement}</DialogTitle>
                <DialogDescription>
                  {ouverte.patient ? `${ouverte.patient.prenom} ${ouverte.patient.nom} (${ouverte.patient.numeroCarte ?? '—'})` : '—'} · émise le{' '}
                  {dateFr(ouverte.createdAt)}
                </DialogDescription>
              </div>
              <BlocEtablissementPatient etablissement={ouverte.etablissementDetail} nomEtablissement={ouverte.etablissement} patient={ouverte.patient} />
              <dl className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Coût</dt><dd className="font-semibold">{montant(ouverte.montantTotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Part assurance</dt><dd>{montant(ouverte.montantAssurance)}</dd></div>
                <div className="flex justify-between border-t pt-1"><dt className="text-muted-foreground">Part assuré</dt><dd className="font-medium">{montant(ouverte.montantPatient)}</dd></div>
              </dl>
              {ouverte.complementaire && ouverte.tarifComplementaire && (
                <p className="text-sm" data-testid="facture-complementaire">
                  <span className="font-medium">Facture complémentaire</span> — acte « {ouverte.tarifComplementaire.acte ?? '—'} » : tarif{' '}
                  {libelleDe(LIBELLE_STATUT_TARIF_PROPOSE, ouverte.tarifComplementaire.statutTarif).toLowerCase()}
                  {ouverte.tarifComplementaire.montantRetenu ? `, montant retenu ${montant(ouverte.tarifComplementaire.montantRetenu)}` : ''}
                  {ouverte.tarifComplementaire.motifRefus ? `. Motif du refus : ${ouverte.tarifComplementaire.motifRefus}. L’assurance ne prend pas cet acte en charge.` : ''}
                  {ouverte.tarifComplementaire.motifAjustement ? `. Motif de l’ajustement : ${ouverte.tarifComplementaire.motifAjustement}` : ''}
                </p>
              )}
              {!ouverte.complementaire && ouverte.actesTarifEnExamen && ouverte.actesTarifEnExamen.length > 0 && (
                <ul className="space-y-1 text-sm" data-testid="actes-tarif-en-examen">
                  <li className="font-medium">Tarif en cours d’examen</li>
                  {ouverte.actesTarifEnExamen.map((a) => (
                    <li key={a.acteId}>
                      <span className="font-medium">{a.libelle}</span> — {a.mention}. Part estimée (à titre indicatif) : assurance{' '}
                      {montant(a.partEstimeeAssurance)}, vous {montant(a.partEstimeePatient)}. Cet acte n’est pas inclus dans cette facture.
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center justify-between text-sm">
                <StatutBadge statut={ouverte.statut} libelles={LIBELLE_STATUT} />
                <span className="text-muted-foreground">
                  Code de facturation : {ouverte.codeValideParPatient ? 'validé' : <span className="font-mono font-semibold text-foreground">{ouverte.code}</span>}
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
