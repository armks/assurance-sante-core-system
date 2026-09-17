'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { validerPreautorisation } from '@/app/dashboard-assureur/medecin-conseil/preautorisations/actions';
import {
  ChampSelect,
  ChampZone,
  DataTable,
  FormulaireModal,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

export interface ActeEnAttente {
  id: string;
  libelle: string;
  categorieActe: string;
  codeActe: string | null;
  quantite: number;
  montantPrescrit: string | null;
  montantSimuleAssurance: string | null;
  montantSimulePatient: string | null;
  datePrescription: string;
  numeroTraitement: string;
  etablissement: string;
  patient: string;
}

const montant = (v: string | null) =>
  v === null || v === '' ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');

export function PreautorisationsFile({ actes }: { actes: ActeEnAttente[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  const colonnes: ColonneTable<ActeEnAttente>[] = [
    { cle: 'patient', entete: 'Patient', triable: true },
    { cle: 'etablissement', entete: 'Établissement', triable: true },
    {
      cle: 'libelle',
      entete: 'Acte',
      rendu: (a) => (
        <span>
          {a.libelle}
          {a.codeActe && (
            <span className="ml-2 text-xs text-muted-foreground">{a.codeActe}</span>
          )}
        </span>
      ),
    },
    {
      cle: 'datePrescription',
      entete: 'Date',
      triable: true,
      valeur: (a) => a.datePrescription,
      rendu: (a) => dateFr(a.datePrescription),
    },
    {
      cle: 'montantSimule',
      entete: 'Montant simulé',
      aligneDroite: true,
      valeur: (a) => Number(a.montantSimuleAssurance ?? 0),
      rendu: (a) => (
        <div className="text-right">
          <div>
            {montant(a.montantSimuleAssurance)}{' '}
            <span className="text-xs text-muted-foreground">assur.</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {montant(a.montantSimulePatient)} patient
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {message && (
        <p className="rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
          {message}
        </p>
      )}

      <DataTable
        donnees={actes}
        cleLigne={(a) => a.id}
        parPage={15}
        recherche={{
          placeholder: 'Patient, établissement, acte…',
          champs: ['patient', 'etablissement', 'libelle', 'numeroTraitement'],
        }}
        colonnes={colonnes}
        actionLigne={(a) => (
          <FormulaireModal
            titre="Décision de pré-autorisation"
            mode="center"
            description={`Dossier ${a.numeroTraitement} — ${a.libelle}. Montant simulé : ${montant(
              a.montantSimuleAssurance,
            )} (assurance) / ${montant(a.montantSimulePatient)} (patient).`}
            declencheur={<Button size="xs">Décider</Button>}
            libelleSoumettre="Enregistrer la décision"
            onSoumettre={async (fd) => {
              const decision = String(fd.get('decision') ?? '') as
                | 'APPROUVE'
                | 'REFUSE';
              return validerPreautorisation(a.id, {
                decision,
                motif: String(fd.get('motif') ?? ''),
              });
            }}
            onSucces={() => {
              setMessage('Décision enregistrée.');
              router.refresh();
            }}
          >
            <ChampSelect
              name="decision"
              label="Décision"
              required
              defaultValue="APPROUVE"
              options={[
                { valeur: 'APPROUVE', libelle: 'Approuver' },
                { valeur: 'REFUSE', libelle: 'Refuser' },
              ]}
            />
            <ChampZone
              name="motif"
              label="Motif de la décision"
              required
              rows={3}
              aide="Tracé dans l'audit (5 caractères minimum)."
            />
          </FormulaireModal>
        )}
        vide="Aucun acte en attente de pré-autorisation."
      />
    </div>
  );
}
