'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { validerPourPaiement } from '@/app/dashboard-assureur/factures-pharmacie-actions';
import { DataTable, StatutBadge, type ColonneTable } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { moisFr, montantF } from '@/lib/format';
import {
  LIBELLE_STATUT_FACTURE_MENSUELLE as LIBELLE_STATUT,
  TON_STATUT_FACTURE_MENSUELLE as TON_STATUT,
} from '@/lib/factures-mensuelles';

export interface FactureMensuellePharmacieComptable {
  id: string;
  pharmacie: string;
  periode: string;
  statut: string;
  montantTotal: string;
  dateValidation: string | null;
  dateProgrammation: string | null;
  datePaiement: string | null;
}


export function FacturesPharmacieComptableEcran({
  factures,
  cible,
}: {
  factures: FactureMensuellePharmacieComptable[];
  cible: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  async function agir(action: (id: string, cible: string) => Promise<{ ok: boolean; message?: string; error?: string }>, id: string) {
    const r = await action(id, cible);
    setMessage(r.ok ? (r.message ?? 'Fait.') : `Erreur : ${r.error}`);
    if (r.ok) router.refresh();
  }

  const colonnes: ColonneTable<FactureMensuellePharmacieComptable>[] = [
    { cle: 'pharmacie', entete: 'Pharmacie', triable: true },
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
      rendu: (f) => montantF(f.montantTotal),
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
          if (f.statut === 'VALIDEE_PHARMACIEN_CONSEIL') {
            return (
              <Button size="xs" onClick={() => agir(validerPourPaiement, f.id)}>
                Valider pour paiement
              </Button>
            );
          }
          if (['PROGRAMMEE_PAIEMENT', 'PAIEMENT_PROGRAMME', 'PARTIELLEMENT_REGLEE'].includes(f.statut)) {
            return <span className="text-xs text-muted-foreground">Payer depuis « Suivi des paiements »</span>;
          }
          return null;
        }}
        vide="Aucune facture pharmacie pour l’instant."
      />
    </div>
  );
}
