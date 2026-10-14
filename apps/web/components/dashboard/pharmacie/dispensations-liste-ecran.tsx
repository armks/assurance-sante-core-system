'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { annulerDispensation } from '@/app/dashboard-pharmacie/dispensation-actions';
import type { DispensationResume } from '@/app/dashboard-pharmacie/dispensation-types';
import {
  DataTable,
  FiltresServeur,
  PaginationServeur,
  StatutBadge,
  type ColonneTable,
  type PageServeur,
} from '@/components/dashboard/patterns';

const LIBELLE_STATUT: Record<string, string> = {
  EN_PREPARATION: 'En préparation',
  EN_ATTENTE_VALIDATION_PATIENT: 'En attente de validation',
  VALIDEE: 'Validée par le patient',
  PAYEE: 'Payée',
  ANNULEE: 'Annulée',
};

const NON_REGLEES = ['EN_PREPARATION', 'EN_ATTENTE_VALIDATION_PATIENT', 'VALIDEE'];

function BoutonSupprimer({ id }: { id: string }) {
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
          if (!window.confirm('Supprimer cette facture non réglée ? Le code envoyé au patient ne sera plus valable.')) return;
          setErreur(null);
          start(async () => {
            const res = await annulerDispensation(id, window.location.pathname);
            if (!res.ok) setErreur(res.error);
            else router.refresh();
          });
        }}
      >
        Supprimer
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
}: {
  /** Page renvoyée par l'API (pagination, recherche, statut, période serveur). */
  dispensations: PageServeur<DispensationResume>;
  vide: string;
  /** Le comptable ne voit que les PAYEE (imposé côté serveur) : pas de choix de statut. */
  filtreStatut?: boolean;
}) {
  const colonnes: ColonneTable<DispensationResume>[] = [
    {
      cle: 'patient',
      entete: 'Patient',
      rendu: (d) =>
        d.patient ? `${d.patient.prenom} ${d.patient.nom} (${d.patient.numeroCarte})` : '—',
    },
    {
      cle: 'medicaments',
      entete: 'Médicaments',
      rendu: (d) => (
        <ul className="list-disc space-y-0.5 pl-4 text-xs">
          {d.lignes.map((l, i) => (
            <li key={i}>
              {l.denominationMedicament} × {l.quantite} — {montantFr(l.montantLigne)}
            </li>
          ))}
        </ul>
      ),
    },
    {
      cle: 'montantTotal',
      entete: 'Montant',
      aligneDroite: true,
      valeur: (d) => Number(d.montantTotal),
      rendu: (d) => montantFr(d.montantTotal),
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
            rendu: (d: DispensationResume) => (NON_REGLEES.includes(d.statut) ? <BoutonSupprimer id={d.id} /> : null),
          },
        ]
      : []),
  ];

  // Liste paginée CÔTÉ SERVEUR (du plus récent au plus ancien) : pas de tri
  // local, qui ne porterait que sur la page affichée.
  return (
    <div className="space-y-3">
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
      <DataTable donnees={dispensations.items} cleLigne={(d) => d.id} parPage={0} piedMasque colonnes={colonnes} vide={vide} />
      <PaginationServeur
        page={dispensations.page}
        pages={dispensations.pages}
        total={dispensations.total}
        limite={dispensations.limite}
      />
    </div>
  );
}
