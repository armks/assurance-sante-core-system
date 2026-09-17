'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { genererFacture } from '@/app/dashboard-centre-medical/comptable/actions';
import {
  DataTable,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LIBELLE_PREAUTORISATION, TON_PREAUTORISATION } from '@/lib/centre-medical';

interface Acte {
  id: string;
  libelle: string;
  categorieActe: string;
  quantite: number;
  montantPrescrit: string | null;
  statutPreautorisation: string;
  statut: string;
}
interface Facture {
  id: string;
  montantTotal: string;
  montantAssurance: string;
  montantPatient: string;
  statut: string;
  codeValideParPatient: boolean;
  dateValidationPatient: string | null;
  dateReglement: string | null;
}
export interface DossierFacturation {
  id: string;
  numeroTraitement: string;
  statut: string;
  dateCloture: string | null;
  actes: Acte[];
  ticket: { id: string; statut: string; facture: Facture | null } | null;
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

  const ticket = dossier.ticket;
  const facture = ticket?.facture ?? null;
  const ticketCloture = ticket?.statut === 'CLOTURE';
  const totalActes = dossier.actes.reduce(
    (s, a) => s + Number(a.montantPrescrit ?? 0) * a.quantite,
    0,
  );

  const colActes: ColonneTable<Acte>[] = [
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
  ];

  const actesExclus = dossier.actes.filter((a) =>
    ['EN_ATTENTE_VALIDATION', 'REFUSEE'].includes(a.statutPreautorisation),
  );

  return (
    <div className="space-y-6">
      {erreur && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {erreur}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dossier</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Ligne label="N° de traitement">{dossier.numeroTraitement}</Ligne>
          <Ligne label="Dossier">
            <StatutBadge statut={dossier.statut} />
          </Ligne>
          <Ligne label="Clôturé le">{dateFr(dossier.dateCloture)}</Ligne>
          <Ligne label="Ticket de soins">
            {ticket ? <StatutBadge statut={ticket.statut} /> : '—'}
          </Ligne>
          <Ligne label="Total actes prescrits">
            {montant(String(totalActes))}
          </Ligne>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actes</CardTitle>
        </CardHeader>
        <CardContent>
          {actesExclus.length > 0 && (
            <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">
              {actesExclus.length} acte(s) en attente ou refusé(s) en
              pré-autorisation — exclus du montant de la facture tant que le
              médecin conseil n’a pas statué (aucun paiement patient possible
              sur ces actes).
            </p>
          )}
          <DataTable
            donnees={dossier.actes}
            cleLigne={(a) => a.id}
            parPage={0}
            colonnes={colActes}
            vide="Aucun acte sur ce ticket."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Facture</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {facture ? (
            <>
              <div className="divide-y">
                <Ligne label="Montant total">
                  {montant(facture.montantTotal)}
                </Ligne>
                <Ligne label="Part assurance">
                  {montant(facture.montantAssurance)}
                </Ligne>
                <Ligne label="Part patient">
                  {montant(facture.montantPatient)}
                </Ligne>
                <Ligne label="Statut">
                  <StatutBadge statut={facture.statut} />
                </Ligne>
              </div>
              <p className="text-sm">
                {facture.codeValideParPatient ? (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Code validé par le patient le{' '}
                    {dateFr(facture.dateValidationPatient)}.
                  </span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">
                    En attente de validation du code par le patient.
                  </span>
                )}
              </p>
              {facture.dateReglement && (
                <p className="text-sm text-muted-foreground">
                  Réglée le {dateFr(facture.dateReglement)}.
                </p>
              )}
            </>
          ) : !ticket ? (
            <p className="text-sm text-muted-foreground">
              Aucun ticket de soins associé à ce dossier.
            </p>
          ) : !ticketCloture ? (
            <p className="text-sm text-muted-foreground">
              Le ticket de soins ({ticket.statut}) doit être clôturé avant la
              facturation.
            </p>
          ) : !peutFacturer ? (
            <p className="text-sm text-muted-foreground">
              La facture est émise par un comptable ou l’administratif du centre
              (ou de l’assurance).
            </p>
          ) : (
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setErreur(null);
                  const r = await genererFacture(dossier.id, ticket.id);
                  if (r.ok) router.refresh();
                  else setErreur(r.error);
                })
              }
            >
              {pending ? 'Génération…' : 'Générer la facture'}
            </Button>
          )}
          {facture == null && ticketCloture && peutFacturer && (
            <p className="text-xs text-muted-foreground">
              Les montants sont calculés par l’API depuis les actes et les
              garanties. Le code de facturation est transmis à l’adhérent pour
              validation — il ne s’affiche pas ici.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
