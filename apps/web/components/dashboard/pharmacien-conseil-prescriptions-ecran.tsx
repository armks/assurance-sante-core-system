'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  ouvrirContestation,
  trancherContestation,
} from '@/app/dashboard-assureur/pharmacien-conseil/prescriptions/actions';
import {
  ChampZone,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface LignePrescription {
  id: string;
  denominationMedicament: string;
  posologie: string;
  quantitePrescrite: number;
  statut: string;
  pharmacieServante: string | null;
  contestation: { id: string; statut: string } | null;
}
export interface OrdonnanceRevue {
  id: string;
  statut: string;
  datePrescription: string;
  dossierId: string;
  numeroTraitement: string;
  etablissement: string;
  patient: string;
  lignes: LignePrescription[];
}
export interface Contestation {
  id: string;
  ligneOrdonnanceId: string;
  denominationMedicament: string;
  posologie: string;
  quantitePrescrite: number;
  pharmacie: { id: string; nom: string } | null;
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

interface LigneAplatie extends LignePrescription {
  ordonnanceId: string;
  dossierId: string;
  numeroTraitement: string;
  etablissement: string;
  patient: string;
  datePrescription: string;
}

function ContesterLigne({ ligne, onSucces }: { ligne: LigneAplatie; onSucces: (m: string) => void }) {
  return (
    <FormulaireModal
      titre="Ouvrir une contestation"
      mode="center"
      description={`${ligne.denominationMedicament} — ${ligne.numeroTraitement} (${ligne.patient}), délivrée par ${ligne.pharmacieServante ?? '—'}.`}
      declencheur={<Button size="xs" variant="destructive">Contester</Button>}
      libelleSoumettre="Ouvrir la contestation"
      onSoumettre={async (fd) => ouvrirContestation(ligne.id, String(fd.get('motif') ?? ''))}
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
  contestation: Contestation;
  onSucces: (m: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        size="xs"
        variant="outline"
        onClick={async () => {
          const r = await trancherContestation(contestation.id, 'VALIDEE');
          if (r.ok) onSucces(r.message ?? 'Validée.');
        }}
      >
        Valider
      </Button>
      <Button
        size="xs"
        variant="destructive"
        onClick={async () => {
          const r = await trancherContestation(contestation.id, 'REJETEE');
          if (r.ok) onSucces(r.message ?? 'Rejetée.');
        }}
      >
        Rejeter
      </Button>
    </div>
  );
}

export function PharmacienConseilPrescriptionsEcran({
  ordonnances,
  contestations,
}: {
  ordonnances: OrdonnanceRevue[];
  contestations: Contestation[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  function succes(msg: string) {
    setMessage(msg);
    router.refresh();
  }

  const lignes: LigneAplatie[] = ordonnances.flatMap((o) =>
    o.lignes.map((l) => ({
      ...l,
      ordonnanceId: o.id,
      dossierId: o.dossierId,
      numeroTraitement: o.numeroTraitement,
      etablissement: o.etablissement,
      patient: o.patient,
      datePrescription: o.datePrescription,
    })),
  );

  const enCours = contestations.filter((c) => ['OUVERT', 'JUSTIFICATION_RECUE'].includes(c.statut));
  const traitees = contestations.filter((c) => ['VALIDEE', 'REJETEE'].includes(c.statut));

  const colonnesLignes: ColonneTable<LigneAplatie>[] = [
    { cle: 'patient', entete: 'Patient', triable: true },
    { cle: 'etablissement', entete: 'Établissement', triable: true },
    { cle: 'denominationMedicament', entete: 'Médicament', triable: true },
    { cle: 'quantitePrescrite', entete: 'Qté', aligneDroite: true },
    {
      cle: 'datePrescription',
      entete: 'Prescrit le',
      triable: true,
      valeur: (l) => l.datePrescription,
      rendu: (l) => dateFr(l.datePrescription),
    },
    {
      cle: 'statut',
      entete: 'Délivrance',
      rendu: (l) =>
        l.statut === 'SERVIE' ? (
          <span className="text-xs">Servie — {l.pharmacieServante}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Non délivrée</span>
        ),
    },
    {
      cle: 'contestation',
      entete: 'Contestation',
      rendu: (l) =>
        l.contestation ? (
          <StatutBadge
            statut={l.contestation.statut}
            map={TON_CONTESTATION}
            libelles={LIBELLE_CONTESTATION}
          />
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="space-y-8">
      {message && (
        <p className="rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
          {message}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prescriptions à examiner</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            donnees={lignes}
            cleLigne={(l) => l.id}
            parPage={15}
            recherche={{
              placeholder: 'Patient, établissement, médicament…',
              champs: ['patient', 'etablissement', 'denominationMedicament', 'numeroTraitement'],
            }}
            colonnes={colonnesLignes}
            actionLigne={(l) => (
              <div className="flex items-center gap-1">
                <Button asChild size="xs" variant="ghost">
                  <Link href={`/dashboard-assureur/pharmacien-conseil/dossiers/${l.dossierId}`}>
                    Dossier
                  </Link>
                </Button>
                {l.statut === 'SERVIE' && !l.contestation && (
                  <ContesterLigne ligne={l} onSucces={succes} />
                )}
              </div>
            )}
            vide="Aucune prescription pour l’instant."
          />
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
              { cle: 'denominationMedicament', entete: 'Médicament' },
              { cle: 'pharmacie', entete: 'Pharmacie', rendu: (c) => c.pharmacie?.nom ?? '—' },
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
              { cle: 'denominationMedicament', entete: 'Médicament' },
              { cle: 'pharmacie', entete: 'Pharmacie', rendu: (c) => c.pharmacie?.nom ?? '—' },
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
