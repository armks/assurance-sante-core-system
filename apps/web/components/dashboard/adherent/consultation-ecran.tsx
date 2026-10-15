'use client';

import { Coins, HandCoins, ReceiptText, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  annulerCode,
  demanderCode,
} from '@/app/dashboard-adherent/consultation/actions';
import type { CodeConsultationGenere } from '@/app/dashboard-adherent/consultation/types';
import type { RecapDispensations } from '@/app/dashboard-pharmacie/dispensation-types';
import { BlocEtablissementPatient, type EtablissementDetail } from '@/components/dashboard/adherent/bloc-etablissement-patient';
import { FiltresFamille } from '@/components/dashboard/adherent/filtres-famille';
import {
  CarteResume,
  ChampSelect,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  PaginationServeur,
  StatutBadge,
  type ColonneTable,
  type PageServeur,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export interface EtablissementOption {
  id: string;
  nom: string;
  ville: string | null;
  categorieEtablissement?: string;
}

export interface CodeConsultation {
  id: string;
  code: string;
  statut: string;
  etablissementId: string;
  dateEmission: string;
  dateExpiration: string;
  etablissement?: string | null;
  etablissementDetail?: EtablissementDetail | null;
  patient?: { nom: string; prenom: string; numeroCarte: string | null } | null;
  numeroTraitement?: string | null;
  montantTotal?: string;
  montantAssurance?: string;
  montantPatient?: string;
}

const LIBELLE_STATUT: Record<string, string> = {
  EMIS: 'Émis',
  CONFIRME_PATIENT: 'Confirmé',
  UTILISE_ETABLISSEMENT: 'Utilisé',
  EXPIRE: 'Expiré',
  ANNULE: 'Annulé',
};

const dateHeureFr = (d: string) => new Date(d).toLocaleString('fr-FR');
const montant = (v: string | undefined) => `${Number(v ?? 0).toLocaleString('fr-FR')} F`;

export function ConsultationEcran({
  etablissements,
  accessibles,
  policeId,
  codes,
  recap = null,
  periode = 'jour',
  cartesFamille = [],
}: {
  etablissements: EtablissementOption[];
  /** Établissements couverts par le niveau d'accès de la formule (sa catégorie et les inférieures). */
  accessibles?: string[];
  policeId: string | null;
  /** Page renvoyée par l'API (pagination, statut, période et n° de carte côté serveur). */
  codes: PageServeur<CodeConsultation>;
  recap?: RecapDispensations | null;
  periode?: string;
  cartesFamille?: { numeroCarte: string; nom: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dernierCode, setDernierCode] = useState<CodeConsultationGenere | null>(null);
  const [ouvert, setOuvert] = useState<CodeConsultation | null>(null);

  const nomEtablissement = (id: string) =>
    etablissements.find((e) => e.id === id)?.nom ?? '—';

  const colonnes: ColonneTable<CodeConsultation>[] = [
    {
      cle: 'etablissementId',
      entete: 'Établissement',
      rendu: (c) => c.etablissement ?? nomEtablissement(c.etablissementId),
    },
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
    { cle: 'code', entete: 'Code' },
    {
      cle: 'montantTotal',
      entete: 'Coût',
      aligneDroite: true,
      rendu: (c) => <span className="font-semibold">{montant(c.montantTotal)}</span>,
    },
    {
      cle: 'montantPatient',
      entete: 'Part assuré',
      aligneDroite: true,
      rendu: (c) => montant(c.montantPatient),
    },
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
    {
      cle: 'dateEmission',
      entete: 'Émis le',
      rendu: (c) => dateHeureFr(c.dateEmission),
    },
    {
      cle: 'dateExpiration',
      entete: 'Expire le',
      valeur: (c) => c.dateExpiration,
      rendu: (c) => dateHeureFr(c.dateExpiration),
    },
  ];

  return (
    <div className="space-y-6">
      {dernierCode && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium text-muted-foreground">
              Code à transmettre ORALEMENT à l’accueil de {dernierCode.etablissement.nom}
            </p>
            <p className="font-mono text-4xl font-bold tracking-widest">{dernierCode.code}</p>
            <p className="text-xs text-muted-foreground">
              Valide 48 heures, à usage unique. Ne le communiquez à personne d’autre que
              l’accueil de l’établissement.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <FormulaireModal
          titre="Demander un code de consultation"
          description="Choisissez l’établissement où vous vous rendez. Le code s’affiche ensuite à l’écran."
          declencheurLabel="Demander un code"
          libelleSoumettre="Générer le code"
          onSoumettre={async (fd) => {
            if (!policeId) {
              return { ok: false, error: "Votre compte n'est rattaché à aucune police active." };
            }
            const etablissementId = String(fd.get('etablissementId') ?? '');
            const res = await demanderCode({ etablissementId, policeId });
            if (res.ok) setDernierCode(res.code ?? null);
            return res;
          }}
          onSucces={() => router.refresh()}
        >
          <ChampSelect
            name="etablissementId"
            label="Établissement"
            required
            placeholder="Choisir un établissement…"
            aide="Seuls les établissements couverts par votre formule sont proposés."
            options={etablissements
              .filter((e) => !accessibles || accessibles.includes(e.id))
              .map((e) => ({
              valeur: e.id,
              libelle: e.ville ? `${e.nom} — ${e.ville}` : e.nom,
            }))}
          />
        </FormulaireModal>
      </div>

      <FiltresFamille periode={periode} cartesFamille={cartesFamille} statuts={LIBELLE_STATUT} />

      <GrilleCartes>
        <CarteResume libelle="Consultations" valeur={recap?.nombre ?? '—'} icon={ReceiptText} />
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
        surClicLigne={setOuvert}
        actionLigne={(c) =>
          c.statut === 'EMIS' ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              onClick={(e) => {
                e.stopPropagation();
                start(async () => {
                  await annulerCode(c.id);
                  router.refresh();
                });
              }}
            >
              Annuler
            </Button>
          ) : null
        }
        vide="Aucun code de consultation ne correspond à ces critères."
      />
      <PaginationServeur page={codes.page} pages={codes.pages} total={codes.total} limite={codes.limite} />

      <Dialog open={!!ouvert} onOpenChange={(o) => !o && setOuvert(null)}>
        <DialogContent side="center" className="w-auto min-w-[min(92vw,28rem)] max-w-[min(92vw,36rem)]">
          {ouvert && (
            <div className="space-y-3">
              <div>
                <DialogTitle>Consultation{ouvert.numeroTraitement ? ` — dossier ${ouvert.numeroTraitement}` : ''}</DialogTitle>
                <DialogDescription>
                  Code émis le {dateHeureFr(ouvert.dateEmission)}, expire le {dateHeureFr(ouvert.dateExpiration)}
                </DialogDescription>
              </div>
              <BlocEtablissementPatient
                etablissement={ouvert.etablissementDetail}
                nomEtablissement={ouvert.etablissement ?? nomEtablissement(ouvert.etablissementId)}
                patient={ouvert.patient}
              />
              <dl className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Coût</dt><dd className="font-semibold">{montant(ouvert.montantTotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Part assurance</dt><dd>{montant(ouvert.montantAssurance)}</dd></div>
                <div className="flex justify-between border-t pt-1"><dt className="text-muted-foreground">Part assuré</dt><dd className="font-medium">{montant(ouvert.montantPatient)}</dd></div>
              </dl>
              <div className="flex items-center justify-between text-sm">
                <StatutBadge statut={ouvert.statut} libelles={LIBELLE_STATUT} />
                {ouvert.statut === 'EMIS' && (
                  <span className="text-muted-foreground">
                    Code : <span className="font-mono font-semibold text-foreground">{ouvert.code}</span>
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
