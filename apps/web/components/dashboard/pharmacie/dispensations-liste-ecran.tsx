'use client';

import { BoutonsImpression } from '@/components/documents/boutons-impression';
import { useRouter } from 'next/navigation';
import { Coins, HandCoins, ReceiptText, ShieldCheck } from 'lucide-react';
import { useState, useTransition } from 'react';

import { validerCodeDispensation } from '@/app/dashboard-adherent/dispensations/actions';
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
import { BlocEtablissementPatient } from '@/components/dashboard/adherent/bloc-etablissement-patient';
import { FiltresFamille } from '@/components/dashboard/adherent/filtres-famille';
import { Button } from '@/components/ui/button';
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
  adherent = false,
  periode = 'jour',
  cartesFamille = [],
}: {
  /** Page renvoyée par l'API (pagination, recherche, statut, période serveur). */
  dispensations: PageServeur<DispensationResume>;
  vide: string;
  /** Le comptable ne voit que les PAYEE (imposé côté serveur) : pas de choix de statut. */
  filtreStatut?: boolean;
  /** Cumul du périmètre filtré (toutes les pages) : affiché en tête quand il est fourni. */
  recap?: RecapDispensations | null;
  /** Espace adhérent : même tableau, avec la pharmacie, le code de confirmation et « Valider le code » (sans suppression). */
  adherent?: boolean;
  /** Espace adhérent : période effective et cartes de la famille pour la barre de recherche. */
  periode?: string;
  cartesFamille?: { numeroCarte: string; nom: string }[];
}) {
  const router = useRouter();
  const [validation, demarrerValidation] = useTransition();
  const [ouverte, setOuverte] = useState<DispensationResume | null>(null);
  const colonnes: ColonneTable<DispensationResume>[] = [
    {
      cle: 'patient',
      entete: 'Patient',
      rendu: (d) =>
        d.patient ? `${d.patient.prenom} ${d.patient.nom} (${d.patient.numeroCarte})` : '—',
    },
    ...(adherent
      ? [{ cle: 'pharmacie', entete: 'Pharmacie', rendu: (d: DispensationResume) => d.pharmacie ?? '—' }]
      : []),
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
    ...(adherent
      ? [
          {
            cle: 'code',
            entete: 'Code de confirmation',
            rendu: (d: DispensationResume) =>
              d.code ? <span className="font-mono font-semibold">{d.code}</span> : <span className="text-muted-foreground">—</span>,
          },
          {
            cle: 'actions',
            entete: '',
            rendu: (d: DispensationResume) =>
              d.code ? (
                <Button
                  size="xs"
                  disabled={validation}
                  onClick={() =>
                    demarrerValidation(async () => {
                      await validerCodeDispensation(d.code!);
                      router.refresh();
                    })
                  }
                >
                  Valider le code
                </Button>
              ) : null,
          },
        ]
      : []),
    ...(filtreStatut && !adherent
      ? [
          {
            cle: 'actions',
            entete: '',
            rendu: (d: DispensationResume) =>
              NON_REGLEES.includes(d.statut) ? <BoutonSupprimer id={d.id} /> : d.statut === 'ANNULEE' ? <BoutonSupprimer id={d.id} definitif /> : d.statut === 'PAYEE' ? <BoutonsImpression type="facture-pharmacie" id={d.id} libelle="Imprimer" taille="xs" /> : null,
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
      {adherent ? (
        <FiltresFamille periode={periode} cartesFamille={cartesFamille} statuts={LIBELLE_STATUT} />
      ) : (
        <FiltresServeur
          recherche={adherent ? undefined : { placeholder: 'Patient, n° de carte, médicament…' }}
          periode
          libellePeriode="Préparée"
          selects={
            filtreStatut
              ? [{ cle: 'statut', libelle: 'Statut', options: Object.entries(LIBELLE_STATUT).map(([valeur, libelle]) => ({ valeur, libelle })) }]
              : []
          }
        />
      )}
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
                  {adherent && ouverte.pharmacie ? ` · ${ouverte.pharmacie}` : ''}
                  {' · '}
                  {dateFr(ouverte.datePreparation)}
                </DialogDescription>
              </div>
              {adherent && (
                <BlocEtablissementPatient etablissement={ouverte.pharmacieDetail} nomEtablissement={ouverte.pharmacie} patient={ouverte.patient} />
              )}
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
              {ouverte.statut === 'PAYEE' && <BoutonsImpression type="facture-pharmacie" id={ouverte.id} />}
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
