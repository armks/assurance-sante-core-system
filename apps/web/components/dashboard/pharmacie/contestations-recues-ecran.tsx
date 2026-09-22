'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { soumettreJustification } from '@/app/dashboard-pharmacie/contestation-actions';
import {
  ChampFichier,
  ChampZone,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

export interface ContestationRecue {
  id: string;
  denominationMedicament: string;
  posologie: string;
  quantitePrescrite: number;
  numeroTraitement: string;
  patient: string;
  motif: string;
  statut: string;
  dateOuverture: string;
  dateLimite: string;
  reponseEtablissement: string | null;
  piecesJustificatives: string[];
}

const LIBELLE_CONTESTATION: Record<string, string> = {
  OUVERT: 'En attente de votre réponse',
  JUSTIFICATION_RECUE: 'Justification transmise',
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

function RepondreContestation({
  contestation,
  cible,
  onSucces,
}: {
  contestation: ContestationRecue;
  cible: string;
  onSucces: (m: string) => void;
}) {
  return (
    <FormulaireModal
      titre="Répondre à la contestation"
      description={`${contestation.denominationMedicament} — ${contestation.numeroTraitement} (${contestation.patient}). Motif du pharmacien conseil : « ${contestation.motif} »`}
      declencheur={<Button size="xs">Répondre</Button>}
      libelleSoumettre="Transmettre la réponse"
      onSoumettre={async (fd) => soumettreJustification(contestation.id, fd, cible)}
      onSucces={() => onSucces('Justification transmise.')}
    >
      <ChampZone
        name="reponse"
        label="Votre réponse"
        required
        minLength={5}
        maxLength={2000}
        rows={5}
        aide="Expliquez la situation au pharmacien conseil."
      />
      <ChampFichier
        name="pieces"
        label="Pièces justificatives"
        multiple
        accept="application/pdf,image/jpeg,image/png"
        aide="PDF, JPEG ou PNG — 10 Mo maximum par fichier."
      />
    </FormulaireModal>
  );
}

export function ContestationsRecuesEcran({
  contestations,
  cible,
}: {
  contestations: ContestationRecue[];
  cible: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  function succes(msg: string) {
    setMessage(msg);
    router.refresh();
  }

  const enAttente = contestations.filter((c) => c.statut === 'OUVERT');
  const traitees = contestations.filter((c) => c.statut !== 'OUVERT');

  const colonnesBase: ColonneTable<ContestationRecue>[] = [
    { cle: 'patient', entete: 'Patient', triable: true },
    { cle: 'denominationMedicament', entete: 'Médicament' },
    { cle: 'numeroTraitement', entete: 'Dossier' },
    {
      cle: 'dateOuverture',
      entete: 'Ouverte le',
      triable: true,
      valeur: (c) => c.dateOuverture,
      rendu: (c) => dateFr(c.dateOuverture),
    },
    {
      cle: 'dateLimite',
      entete: 'Date limite',
      triable: true,
      valeur: (c) => c.dateLimite,
      rendu: (c) => dateFr(c.dateLimite),
    },
  ];

  return (
    <div className="space-y-8">
      {message && (
        <p className="rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
          {message}
        </p>
      )}

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Contestations reçues — en attente de votre réponse
        </h2>
        <DataTable
          donnees={enAttente}
          cleLigne={(c) => c.id}
          parPage={10}
          colonnes={[
            ...colonnesBase,
            { cle: 'motif', entete: 'Motif', rendu: (c) => <span className="text-xs">{c.motif}</span> },
          ]}
          actionLigne={(c) => <RepondreContestation contestation={c} cible={cible} onSucces={succes} />}
          vide="Aucune contestation en attente."
        />
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Historique</h2>
        <DataTable
          donnees={traitees}
          cleLigne={(c) => c.id}
          parPage={10}
          colonnes={[
            ...colonnesBase,
            {
              cle: 'statut',
              entete: 'Statut',
              rendu: (c) => (
                <StatutBadge statut={c.statut} map={TON_CONTESTATION} libelles={LIBELLE_CONTESTATION} />
              ),
            },
          ]}
          vide="Aucune contestation traitée pour l’instant."
        />
      </div>
    </div>
  );
}
