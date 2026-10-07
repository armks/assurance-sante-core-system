'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  ouvrirContestationActe,
  trancherContestationActe,
} from '@/app/dashboard-assureur/medecin-conseil/contestations/actions';
import {
  Alerte,
  ChampZone,
  DataTable,
  FiltresServeur,
  FormulaireModal,
  PaginationServeur,
  StatutBadge,
  type ColonneTable,
  type PageServeur,
} from '@/components/dashboard/patterns';
import { CATEGORIES_ACTE } from '@/lib/centre-medical';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  libelleCategorieActe,
  optionsCategorieActe,
} from '@/lib/referentiel';

export interface ActeRevue {
  id: string;
  categorieActe: string;
  libelle: string;
  codeActe: string | null;
  quantite: number;
  montantPrescrit: string | null;
  statut: string;
  datePrescription: string;
  dossierId: string;
  numeroTraitement: string;
  etablissement: string;
  patient: string;
  contestation: { id: string; statut: string } | null;
}
export interface ContestationActe {
  id: string;
  acteDossierId: string;
  categorieActe: string;
  libelle: string;
  codeActe: string | null;
  montantPrescrit: string | null;
  etablissement: string;
  numeroTraitement: string;
  patient: string;
  motif: string;
  statut: string;
  dateOuverture: string;
  dateLimite: string;
  reponseEtablissement: string | null;
  piecesJustificatives: string[];
  dateCloture: string | null;
  ouvertPar: string | null;
  traitePar: string | null;
}

const LIBELLE_CONTESTATION: Record<string, string> = {
  OUVERT: 'Ouverte',
  JUSTIFICATION_RECUE: 'Justification reçue',
  VALIDEE: 'Validée',
  REJETEE: 'Rejetée',
};
const TON_CONTESTATION: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  OUVERT: 'attention',
  JUSTIFICATION_RECUE: 'attention',
  VALIDEE: 'succes',
  REJETEE: 'danger',
};

const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');
const montantFr = (m: string | null) => (m ? `${Number(m).toLocaleString('fr-FR')} F` : '—');

function ContesterActe({ acte, onSucces }: { acte: ActeRevue; onSucces: (m: string) => void }) {
  return (
    <FormulaireModal
      titre="Ouvrir une contestation"
      mode="center"
      description={`${acte.libelle} — ${acte.numeroTraitement} (${acte.patient}), établissement ${acte.etablissement}.`}
      declencheur={<Button size="xs" variant="destructive">Contester</Button>}
      libelleSoumettre="Ouvrir la contestation"
      onSoumettre={async (fd) => ouvrirContestationActe(acte.id, String(fd.get('motif') ?? ''))}
      onSucces={() => onSucces('Contestation ouverte.')}
    >
      <ChampZone
        name="motif"
        label="Motif de la contestation"
        required
        minLength={5}
        maxLength={1000}
        rows={4}
        aide="Tracé dans l'audit — expliquez précisément ce qui est contesté."
      />
    </FormulaireModal>
  );
}

function TrancherContestation({
  contestation,
  onSucces,
}: {
  contestation: ContestationActe;
  onSucces: (m: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        size="xs"
        variant="outline"
        onClick={async () => {
          const r = await trancherContestationActe(contestation.id, 'VALIDEE');
          if (r.ok) onSucces(r.message ?? 'Validée.');
        }}
      >
        Valider
      </Button>
      <Button
        size="xs"
        variant="destructive"
        onClick={async () => {
          const r = await trancherContestationActe(contestation.id, 'REJETEE');
          if (r.ok) onSucces(r.message ?? 'Rejetée.');
        }}
      >
        Rejeter
      </Button>
    </div>
  );
}

/** État de la DERNIÈRE contestation d'un acte — filtre serveur `contestation`. */
const OPTIONS_CONTESTATION = [
  { valeur: 'SANS', libelle: 'Jamais contesté' },
  { valeur: 'EN_COURS', libelle: 'Contestation en cours' },
  { valeur: 'TRAITEE', libelle: 'Contestation tranchée' },
];
const OPTIONS_CATEGORIE = optionsCategorieActe(CATEGORIES_ACTE);

export function MedecinConseilActesEcran({
  actes,
  contestations,
}: {
  /** Page d'actes renvoyée par l'API (pagination, recherche et filtres serveur). */
  actes: PageServeur<ActeRevue>;
  contestations: ContestationActe[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  function succes(msg: string) {
    setMessage(msg);
    router.refresh();
  }

  const enCours = contestations.filter((c) => ['OUVERT', 'JUSTIFICATION_RECUE'].includes(c.statut));
  const traitees = contestations.filter((c) => ['VALIDEE', 'REJETEE'].includes(c.statut));

  // Colonnes NON triables : la liste est paginée côté serveur (ordre : du plus
  // récent au plus ancien) — un tri local ne porterait que sur la page affichée.
  const colonnesActes: ColonneTable<ActeRevue>[] = [
    { cle: 'patient', entete: 'Patient' },
    { cle: 'etablissement', entete: 'Établissement' },
    { cle: 'libelle', entete: 'Acte' },
    {
      cle: 'categorieActe',
      entete: 'Catégorie',
      valeur: (a) => libelleCategorieActe(a.categorieActe),
      rendu: (a) => libelleCategorieActe(a.categorieActe),
    },
    {
      cle: 'montantPrescrit',
      entete: 'Montant',
      aligneDroite: true,
      valeur: (a) => Number(a.montantPrescrit ?? 0),
      rendu: (a) => montantFr(a.montantPrescrit),
    },
    {
      cle: 'datePrescription',
      entete: 'Prescrit le',
      rendu: (a) => dateFr(a.datePrescription),
    },
    {
      cle: 'contestation',
      entete: 'Contestation',
      rendu: (a) =>
        a.contestation ? (
          <StatutBadge statut={a.contestation.statut} map={TON_CONTESTATION} libelles={LIBELLE_CONTESTATION} />
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="space-y-8">
      {message && <Alerte ton="succes">{message}</Alerte>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actes à examiner</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FiltresServeur
            recherche={{ placeholder: 'Patient, n° de traitement, acte, établissement…' }}
            periode
            libellePeriode="Prescrit"
            selects={[
              { cle: 'contestation', libelle: 'Contestation', options: OPTIONS_CONTESTATION },
              { cle: 'categorie', libelle: 'Catégorie', options: OPTIONS_CATEGORIE },
            ]}
          />
          <DataTable
            donnees={actes.items}
            cleLigne={(a) => a.id}
            parPage={0}
            piedMasque
            colonnes={colonnesActes}
            actionLigne={(a) => (
              <div className="flex items-center gap-1">
                <Button asChild size="xs" variant="ghost">
                  <Link href={`/dashboard-assureur/medecin-conseil/dossiers/${a.dossierId}`}>Dossier</Link>
                </Button>
                {!a.contestation && <ContesterActe acte={a} onSucces={succes} />}
              </div>
            )}
            vide="Aucun acte ne correspond à ces critères."
          />
          <PaginationServeur page={actes.page} pages={actes.pages} total={actes.total} limite={actes.limite} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contestations en cours</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            donnees={enCours}
            cleLigne={(c) => c.id}
            parPage={10}
            colonnes={[
              { cle: 'patient', entete: 'Patient', triable: true },
              { cle: 'libelle', entete: 'Acte' },
              { cle: 'etablissement', entete: 'Établissement' },
              {
                cle: 'statut',
                entete: 'Statut',
                rendu: (c) => (
                  <StatutBadge statut={c.statut} map={TON_CONTESTATION} libelles={LIBELLE_CONTESTATION} />
                ),
              },
              {
                cle: 'dateLimite',
                entete: 'Date limite',
                triable: true,
                valeur: (c) => c.dateLimite,
                rendu: (c) => dateFr(c.dateLimite),
              },
              {
                cle: 'reponseEtablissement',
                entete: 'Réponse',
                rendu: (c) => c.reponseEtablissement ?? <span className="text-muted-foreground">En attente</span>,
              },
            ]}
            actionLigne={(c) => <TrancherContestation contestation={c} onSucces={succes} />}
            vide="Aucune contestation en cours."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contestations traitées</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            donnees={traitees}
            cleLigne={(c) => c.id}
            parPage={10}
            colonnes={[
              { cle: 'patient', entete: 'Patient', triable: true },
              { cle: 'libelle', entete: 'Acte' },
              { cle: 'etablissement', entete: 'Établissement' },
              {
                cle: 'statut',
                entete: 'Décision',
                rendu: (c) => (
                  <StatutBadge statut={c.statut} map={TON_CONTESTATION} libelles={LIBELLE_CONTESTATION} />
                ),
              },
              {
                cle: 'dateCloture',
                entete: 'Tranchée le',
                triable: true,
                valeur: (c) => c.dateCloture ?? '',
                rendu: (c) => (c.dateCloture ? dateFr(c.dateCloture) : '—'),
              },
            ]}
            vide="Aucune contestation traitée pour l’instant."
          />
        </CardContent>
      </Card>
    </div>
  );
}
