'use client';

import type { DispensationResume } from '@/app/dashboard-pharmacie/dispensation-types';
import {
  DataTable,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';

const LIBELLE_STATUT: Record<string, string> = {
  EN_PREPARATION: 'En préparation',
  EN_ATTENTE_VALIDATION_PATIENT: 'En attente de validation',
  VALIDEE: 'Validée par le patient',
  PAYEE: 'Payée',
  ANNULEE: 'Annulée',
};

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
}: {
  dispensations: DispensationResume[];
  vide: string;
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
      triable: true,
      valeur: (d) => d.datePreparation,
      rendu: (d) => dateFr(d.datePreparation),
    },
    {
      cle: 'datePaiement',
      entete: 'Payée le',
      triable: true,
      valeur: (d) => d.datePaiement ?? '',
      rendu: (d) => dateFr(d.datePaiement),
    },
  ];

  return (
    <DataTable
      donnees={dispensations}
      cleLigne={(d) => d.id}
      parPage={10}
      colonnes={colonnes}
      vide={vide}
    />
  );
}
