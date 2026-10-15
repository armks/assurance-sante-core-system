'use client';

import { useRouter } from 'next/navigation';
import { Coins, HandCoins, ReceiptText, ShieldCheck } from 'lucide-react';
import { useState, useTransition } from 'react';

import { annulerDispensation, supprimerDispensationAnnulee } from '@/app/dashboard-pharmacie/dispensation-actions';
import type { DispensationResume, RecapDispensations } from '@/app/dashboard-pharmacie/dispensation-types';
import {
  CarteResume,
  DataTable,
  FiltresServeur,
  GrilleCartes,
  PaginationServeur,
  StatutBadge,
  type ColonneTable,
  type PageServeur,
} from '@/components/dashboard/patterns';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

const LIBELLE_STATUT: Record<string, string> = {
  EN_PREPARATION: 'En préparation',
  EN_ATTENTE_VALIDATION_PATIENT: 'En attente de validation',
  VALIDEE: 'Validée par le patient',
  PAYEE: 'Payée',
  ANNULEE: 'Annulée',
};

const NON_REGLEES = ['EN_PREPARATION', 'EN_ATTENTE_VALIDATION_PATIENT', 'VALIDEE'];

function BoutonSupprimer({ id, definitif = false }: { id: string; definitif?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <div className="space-y-0.5">
      <button
        type="button"
        disabled={pending}
        className="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
        onClick={() => {
          const message = definitif
            ? 'Supprimer définitivement cette facture annulée ? Cette action est irréversible.'
            : 'Supprimer cette facture non réglée ? Le code envoyé au patient ne sera plus valable.';
          if (!window.confirm(message)) return;
          setErreur(null);
          start(async () => {
            const res = await (definitif ? supprimerDispensationAnnulee : annulerDispensation)(id, window.location.pathname);
            if (!res.ok) setErreur(res.error);
            else router.refresh();
          });
        }}
      >
        {definitif ? 'Vider' : 'Supprimer'}
      </button>
      {erreur && <p className="text-xs text-destructive">{erreur}</p>}
    </div>
  );
}

const dateFr = (d: string | null) => (d ? new Date(d).toLocaleString('fr-FR') : '—');
const montantFr = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;

/**
 * Liste en lecture seule des dispensations de SA pharmacie — module
 * `pharmacy/` (verrou par ligne). Remplace la lecture de l'ancien mécanisme
 * `codes_ordonnance` (PROMPT 19), qui ne reflète plus l'activité réelle
 * depuis la révision du flux. Réutilisée par le pharmacien (tous statuts) et
 * le comptable (statut=PAYEE, filtré côté serveur).
 */
export function DispensationsListeEcran({
  dispensations,
  vide,
  filtreStatut = true,
  recap = null,
}: {
  /** Page renvoyée par l'API (pagination, recherche, statut, période serveur). */
  dispensations: PageServeur<DispensationResume>;
  vide: string;
  /** Le comptable ne voit que les PAYEE (imposé côté serveur) : pas de choix de statut. */
  filtreStatut?: boolean;
  /** Cumul du périmètre filtré (toutes les pages) : affiché en tête quand il est fourni. */
  recap?: RecapDispensations | null;
}) {
  const [ouverte, setOuverte] = useState<DispensationResume | null>(null);
  const colonnes: ColonneTable<DispensationResume>[] = [
    {
      cle: 'patient',
      entete: 'Patient',
      rendu: (d) =>
        d.patient ? `${d.patient.prenom} ${d.patient.nom} (${d.patient.numeroCarte})` : '—',
    },
    {
      cle: 'montantTotal',
      entete: 'Coût',
      aligneDroite: true,
      valeur: (d) => Number(d.montantTotal),
      rendu: (d) => montantFr(d.montantTotal),
    },
    {
      cle: 'montantAssurance',
      entete: 'Part assurance',
      aligneDroite: true,
      valeur: (d) => Number(d.montantAssurance),
      rendu: (d) => montantFr(d.montantAssurance),
    },
    {
      cle: 'montantPatient',
      entete: 'Part assuré',
      aligneDroite: true,
      valeur: (d) => Number(d.montantPatient),
      rendu: (d) => montantFr(d.montantPatient),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (d) => <StatutBadge statut={d.statut} libelles={LIBELLE_STATUT} />,
    },
    {
      cle: 'datePreparation',
      entete: 'Préparée le',
      rendu: (d) => dateFr(d.datePreparation),
    },
    {
      cle: 'datePaiement',
      entete: 'Payée le',
      rendu: (d) => dateFr(d.datePaiement),
    },
    ...(filtreStatut
      ? [
          {
            cle: 'actions',
            entete: '',
            rendu: (d: DispensationResume) =>
              NON_REGLEES.includes(d.statut) ? <BoutonSupprimer id={d.id} /> : d.statut === 'ANNULEE' ? <BoutonSupprimer id={d.id} definitif /> : null,
          },
        ]
      : []),
  ];

  // Liste paginée CÔTÉ SERVEUR (du plus récent au plus ancien) : pas de tri
  // local, qui ne porterait que sur la page affichée.
  return (
    <div className="space-y-3">
      {recap && (
        <GrilleCartes>
          <CarteResume libelle="Factures" valeur={recap.nombre} icon={ReceiptText} />
          <CarteResume libelle="Coût total" valeur={montantFr(recap.montantTotal)} icon={Coins} />
          <CarteResume libelle="Part assurance" valeur={montantFr(recap.montantAssurance)} icon={ShieldCheck} />
          <CarteResume libelle="Part assuré" valeur={montantFr(recap.montantPatient)} icon={HandCoins} />
        </GrilleCartes>
      )}
      <FiltresServeur
        recherche={{ placeholder: 'Patient, n° de carte, médicament…' }}
        periode
        libellePeriode="Préparée"
        selects={
          filtreStatut
            ? [{ cle: 'statut', libelle: 'Statut', options: Object.entries(LIBELLE_STATUT).map(([valeur, libelle]) => ({ valeur, libelle })) }]
            : []
        }
      />
      <DataTable
        donnees={dispensations.items}
        cleLigne={(d) => d.id}
        parPage={0}
        piedMasque
        colonnes={colonnes}
        vide={vide}
        surClicLigne={setOuverte}
      />
      <Dialog open={!!ouverte} onOpenChange={(o) => !o && setOuverte(null)}>
        <DialogContent side="center" className="w-auto min-w-[min(92vw,28rem)] max-w-[min(92vw,36rem)]">
          {ouverte && (
            <div className="space-y-3">
              <div>
                <DialogTitle>Prescription servie</DialogTitle>
                <DialogDescription>
                  {ouverte.patient ? `${ouverte.patient.prenom} ${ouverte.patient.nom} (${ouverte.patient.numeroCarte})` : '—'}
                  {' · '}
                  {dateFr(ouverte.datePreparation)}
                </DialogDescription>
              </div>
              <ul className="divide-y rounded-md border text-sm">
                {ouverte.lignes.map((l, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span>
                      {l.denominationMedicament} × {l.quantite}
                      {l.enLitige && <span className="ml-2 text-xs text-amber-600">(en litige)</span>}
                    </span>
                    <span className="whitespace-nowrap tabular-nums">{montantFr(l.montantLigne)}</span>
                  </li>
                ))}
              </ul>
              <dl className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Coût</dt><dd className="font-semibold">{montantFr(ouverte.montantTotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Part assurance</dt><dd>{montantFr(ouverte.montantAssurance)}</dd></div>
                <div className="flex justify-between border-t pt-1"><dt className="text-muted-foreground">Part assuré</dt><dd className="font-medium">{montantFr(ouverte.montantPatient)}</dd></div>
              </dl>
              <div className="flex items-center justify-between text-sm">
                <StatutBadge statut={ouverte.statut} libelles={LIBELLE_STATUT} />
                <span className="text-muted-foreground">{ouverte.datePaiement ? `Payée le ${dateFr(ouverte.datePaiement)}` : "Non réglée"}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <PaginationServeur
        page={dispensations.page}
        pages={dispensations.pages}
        total={dispensations.total}
        limite={dispensations.limite}
      />
    </div>
  );
}
