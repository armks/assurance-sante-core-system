'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { genererFactureSelection } from '@/app/dashboard-centre-medical/comptable/actions';
import {
  DataTable,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LIBELLE_PREAUTORISATION,
  STATUTS_ACTE_FACTURABLES,
  TON_PREAUTORISATION,
} from '@/lib/centre-medical';
import { StatutActe } from './statut-acte';
import {
  LIBELLE_STATUT_DOSSIER,
  LIBELLE_STATUT_FACTURE_DOSSIER,
  LIBELLE_STATUT_TICKET,
  TON_STATUT_FACTURE_DOSSIER,
} from '@/lib/dossier-soins';

interface LigneFacturationActe {
  id: string;
  statut: string; // A_PAYER | PAYE
  montantReclame: string;
  datePaiement: string | null;
}
interface Acte {
  id: string;
  libelle: string;
  categorieActe: string;
  quantite: number;
  montantPrescrit: string | null;
  statutPreautorisation: string;
  statut: string;
  dateRealisation: string | null;
  lignesFacturation: LigneFacturationActe[];
}
interface CycleFacturation {
  id: string;
  montantTotal: string;
  montantAssurance: string;
  montantPatient: string;
  statut: string;
  codeValideParPatient: boolean;
  dateValidationPatient: string | null;
  dateReglement: string | null;
  createdAt: string;
}
export interface DossierFacturation {
  id: string;
  numeroTraitement: string;
  statut: string;
  dateCloture: string | null;
  actes: Acte[];
  /** Présent uniquement via `GET /care-episode/dossiers/:id` (détail). */
  soldeRestantDu?: string;
  ticket: { id: string; statut: string; factures: CycleFacturation[] } | null;
}

const montant = (v: string | null) =>
  v === null || v === '' ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;
const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

/**
 * Même règle que l'API (`genererFactureSelection`, qui reste l'autorité) :
 * acte réalisé, pré-autorisation non bloquante, pas déjà réglé.
 */
function estFacturable(a: Acte): boolean {
  if (!STATUTS_ACTE_FACTURABLES.includes(a.statut)) return false;
  if (PREAUTORISATION_NON_FACTURABLE.includes(a.statutPreautorisation)) return false;
  if (a.lignesFacturation.some((l) => l.statut === 'PAYE')) return false;
  return true;
}

/** Miroir de `STATUTS_PREAUTORISATION_NON_FACTURABLES` (API). */
const PREAUTORISATION_NON_FACTURABLE = [
  'EN_ATTENTE_EXPLOITATION',
  'EN_ATTENTE_MEDECIN_CONSEIL',
  'REFUSEE',
];

function statutFacturationActe(a: Acte): { label: string; ton: 'succes' | 'attention' | 'neutre' | 'danger' } {
  const ligne = a.lignesFacturation[0]; // trié du plus récent au plus ancien côté API
  if (ligne?.statut === 'PAYE') return { label: 'Payé', ton: 'succes' };
  if (!STATUTS_ACTE_FACTURABLES.includes(a.statut)) {
    return { label: 'Non facturable (non réalisé)', ton: 'attention' };
  }
  if (PREAUTORISATION_NON_FACTURABLE.includes(a.statutPreautorisation)) {
    return { label: 'Non facturable (pré-autorisation)', ton: 'danger' };
  }
  if (ligne?.statut === 'A_PAYER') return { label: 'Code généré (en attente)', ton: 'attention' };
  return { label: 'À sélectionner', ton: 'neutre' };
}

export function TicketDetail({
  dossier,
  peutFacturer,
}: {
  dossier: DossierFacturation;
  peutFacturer: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());

  const ticket = dossier.ticket;
  const cycles = ticket?.factures ?? [];
  const soldeRestantDu = Number(dossier.soldeRestantDu ?? 0);
  const dossierSolde = soldeRestantDu <= 0;
  const totalActes = dossier.actes.reduce(
    (s, a) => s + Number(a.montantPrescrit ?? 0) * a.quantite,
    0,
  );
  const montantSelectionne = dossier.actes
    .filter((a) => selection.has(a.id))
    .reduce((s, a) => s + Number(a.montantPrescrit ?? 0) * a.quantite, 0);

  function basculer(acteId: string) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(acteId)) next.delete(acteId);
      else next.add(acteId);
      return next;
    });
  }

  const colActes: ColonneTable<Acte>[] = useMemo(
    () => [
      {
        cle: 'select',
        entete: '',
        rendu: (a) =>
          estFacturable(a) && peutFacturer ? (
            <input
              type="checkbox"
              className="size-4"
              checked={selection.has(a.id)}
              onChange={() => basculer(a.id)}
              aria-label={`Sélectionner ${a.libelle}`}
            />
          ) : null,
      },
      { cle: 'libelle', entete: 'Libellé', triable: true },
      {
        cle: 'categorieActe',
        entete: 'Catégorie',
        rendu: (a) => a.categorieActe.replace(/_/g, ' '),
      },
      { cle: 'quantite', entete: 'Qté', aligneDroite: true },
      {
        cle: 'montantPrescrit',
        entete: 'Montant',
        aligneDroite: true,
        valeur: (a) => Number(a.montantPrescrit ?? 0),
        rendu: (a) => montant(a.montantPrescrit),
      },
      {
        cle: 'statut',
        entete: 'Réalisation',
        rendu: (a) => <StatutActe statut={a.statut} dateRealisation={a.dateRealisation} />,
      },
      {
        cle: 'statutPreautorisation',
        entete: 'Pré-autorisation',
        rendu: (a) =>
          a.statutPreautorisation === 'NON_REQUISE' ? (
            '—'
          ) : (
            <StatutBadge
              statut={a.statutPreautorisation}
              map={TON_PREAUTORISATION}
              libelles={LIBELLE_PREAUTORISATION}
            />
          ),
      },
      {
        cle: 'facturation',
        entete: 'Facturation',
        rendu: (a) => {
          const { label, ton } = statutFacturationActe(a);
          return <StatutBadge statut={label} ton={ton} libelle={label} />;
        },
      },
    ],
    [selection, peutFacturer],
  );

  return (
    <div className="space-y-6">
      {erreur && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {erreur}
        </div>
      )}
      {message && (
        <div className="rounded-md border border-emerald-300/70 bg-emerald-50/50 p-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
          {message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dossier</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Ligne label="N° de traitement">{dossier.numeroTraitement}</Ligne>
          <Ligne label="Dossier">
            <StatutBadge statut={dossier.statut} libelles={LIBELLE_STATUT_DOSSIER} />
          </Ligne>
          <Ligne label="Clôturé le">{dateFr(dossier.dateCloture)}</Ligne>
          <Ligne label="Ticket de soins">
            {ticket ? <StatutBadge statut={ticket.statut} libelles={LIBELLE_STATUT_TICKET} /> : '—'}
          </Ligne>
          <Ligne label="Total actes prescrits">
            {montant(String(totalActes))}
          </Ligne>
          {dossier.soldeRestantDu !== undefined && (
            <Ligne label="Solde restant dû">
              <span className={dossierSolde ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}>
                {montant(dossier.soldeRestantDu)}
              </span>
            </Ligne>
          )}
        </CardContent>
        {dossier.soldeRestantDu !== undefined && !dossierSolde && (
          <CardContent className="pt-0">
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              Dossier non soldé — clôture impossible tant que le solde restant
              dû n’est pas à zéro.
            </p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actes — sélection pour facturation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Cochez les actes à régler maintenant. Seuls les actes marqués
            « Réalisé » par le médecin traitant sont facturables ; les actes
            prescrits non réalisés, en attente/refusés de pré-autorisation ou
            déjà payés ne sont pas sélectionnables.
          </p>
          <DataTable
            donnees={dossier.actes}
            cleLigne={(a) => a.id}
            parPage={0}
            colonnes={colActes}
            vide="Aucun acte sur ce dossier."
          />

          {peutFacturer && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <span className="text-sm">
                Montant sélectionné :{' '}
                <span className="font-semibold">{montant(String(montantSelectionne))}</span>
                {' '}({selection.size} acte{selection.size > 1 ? 's' : ''})
              </span>
              <Button
                size="sm"
                disabled={pending || selection.size === 0}
                onClick={() =>
                  start(async () => {
                    setErreur(null);
                    setMessage(null);
                    const r = await genererFactureSelection(dossier.id, [...selection]);
                    if (r.ok) {
                      setMessage(r.message ?? 'Code de facturation généré.');
                      setSelection(new Set());
                      router.refresh();
                    } else {
                      setErreur(r.error);
                    }
                  })
                }
              >
                {pending ? 'Génération…' : 'Générer le code de facturation'}
              </Button>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Le code de facturation est transmis à l’adhérent (dashboard —
            e-mail et SMS à raccorder séparément) pour validation ; il ne
            s’affiche jamais ici.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cycles de facturation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {cycles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun cycle de facturation généré pour l’instant.
            </p>
          ) : (
            cycles.map((f) => (
              <div key={f.id} className="divide-y rounded-md border p-3">
                <Ligne label="Créé le">{dateFr(f.createdAt)}</Ligne>
                <Ligne label="Montant total">{montant(f.montantTotal)}</Ligne>
                <Ligne label="Part assurance">{montant(f.montantAssurance)}</Ligne>
                <Ligne label="Part patient">{montant(f.montantPatient)}</Ligne>
                <Ligne label="Statut">
                  <StatutBadge
                    statut={f.statut}
                    map={TON_STATUT_FACTURE_DOSSIER}
                    libelles={LIBELLE_STATUT_FACTURE_DOSSIER}
                  />
                </Ligne>
                <div className="pt-2 text-sm">
                  {f.codeValideParPatient ? (
                    <span className="text-emerald-700 dark:text-emerald-400">
                      Code validé par le patient le {dateFr(f.dateValidationPatient)}.
                    </span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400">
                      En attente de validation du code par le patient.
                    </span>
                  )}
                </div>
                {f.dateReglement && (
                  <p className="pt-1 text-sm text-muted-foreground">
                    Réglée le {dateFr(f.dateReglement)}.
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
