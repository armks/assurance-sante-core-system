'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  marquerFactureMensuelleEtablissementPayee,
  programmerPaiementFactureMensuelleEtablissement,
} from '@/app/dashboard-assureur/factures-etablissement-actions';
import { DataTable, StatutBadge, type ColonneTable } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

export interface FactureMensuelleEtablissementComptable {
  id: string;
  etablissement: string;
  periode: string;
  statut: string;
  montantTotal: string;
  dateVerification: string | null;
  dateProgrammation: string | null;
  datePaiement: string | null;
}

const LIBELLE_STATUT: Record<string, string> = {
  VERIFIEE_MEDECIN_CONSEIL: 'Vérifiée — prête à programmer',
  PROGRAMMEE_PAIEMENT: 'Paiement programmé',
  PAYEE: 'Payée',
};
const TON_STATUT: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  VERIFIEE_MEDECIN_CONSEIL: 'attention',
  PROGRAMMEE_PAIEMENT: 'attention',
  PAYEE: 'succes',
};

const montant = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;
const moisFr = (d: string) =>
  new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function FacturesEtablissementComptableEcran({
  factures,
  cible,
}: {
  factures: FactureMensuelleEtablissementComptable[];
  cible: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  async function agir(action: (id: string, cible: string) => Promise<{ ok: boolean; message?: string; error?: string }>, id: string) {
    const r = await action(id, cible);
    setMessage(r.ok ? (r.message ?? 'Fait.') : `Erreur : ${r.error}`);
    if (r.ok) router.refresh();
  }

  const colonnes: ColonneTable<FactureMensuelleEtablissementComptable>[] = [
    { cle: 'etablissement', entete: 'Établissement', triable: true },
    {
      cle: 'periode',
      entete: 'Période',
      triable: true,
      valeur: (f) => f.periode,
      rendu: (f) => moisFr(f.periode),
    },
    {
      cle: 'montantTotal',
      entete: 'Montant',
      aligneDroite: true,
      valeur: (f) => Number(f.montantTotal),
      rendu: (f) => montant(f.montantTotal),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (f) => <StatutBadge statut={f.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />,
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
        donnees={factures}
        cleLigne={(f) => f.id}
        parPage={12}
        colonnes={colonnes}
        actionLigne={(f) => {
          if (f.statut === 'VERIFIEE_MEDECIN_CONSEIL') {
            return (
              <Button size="xs" onClick={() => agir(programmerPaiementFactureMensuelleEtablissement, f.id)}>
                Programmer le paiement
              </Button>
            );
          }
          if (f.statut === 'PROGRAMMEE_PAIEMENT') {
            return (
              <Button size="xs" onClick={() => agir(marquerFactureMensuelleEtablissementPayee, f.id)}>
                Marquer payée
              </Button>
            );
          }
          return null;
        }}
        vide="Aucune facture établissement vérifiée par le médecin conseil pour l’instant."
      />
    </div>
  );
}
