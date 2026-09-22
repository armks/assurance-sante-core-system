'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { soumettreFactureMensuelle } from '@/app/dashboard-pharmacie/facture-mensuelle-actions';
import { DataTable, StatutBadge, type ColonneTable } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface FactureMensuelle {
  id: string;
  periode: string;
  statut: string;
  montantTotal: string;
  dateSoumission: string | null;
  dateValidation: string | null;
  datePaiement: string | null;
}

const LIBELLE_STATUT: Record<string, string> = {
  EN_PREPARATION: 'En préparation',
  SOUMISE: 'Soumise — en attente du pharmacien conseil',
  VALIDEE_PHARMACIEN_CONSEIL: 'Validée par le pharmacien conseil',
  PROGRAMMEE_PAIEMENT: 'Paiement programmé',
  PAYEE: 'Payée',
};
const TON_STATUT: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  EN_PREPARATION: 'neutre',
  SOUMISE: 'attention',
  VALIDEE_PHARMACIEN_CONSEIL: 'attention',
  PROGRAMMEE_PAIEMENT: 'attention',
  PAYEE: 'succes',
};

const montant = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;
const moisFr = (d: string) =>
  new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Premier jour du mois précédent, au format YYYY-MM-01 (même logique que `PharmacyService.bornesMoisPrecedent`). */
function periodePrecedente(): { iso: string; libelle: string } {
  const maintenant = new Date();
  const debut = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - 1, 1));
  return { iso: debut.toISOString().slice(0, 10), libelle: moisFr(debut.toISOString()) };
}

export function FacturesMensuellesEcran({ factures, cible }: { factures: FactureMensuelle[]; cible: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [pending, start] = useTransition();

  const { iso: periodeAttendue, libelle: libellePeriode } = periodePrecedente();
  const dejaSoumise = factures.some((f) => f.periode.slice(0, 10) === periodeAttendue);

  function soumettre() {
    start(async () => {
      const r = await soumettreFactureMensuelle(periodeAttendue, cible);
      setMessage({ ok: r.ok, texte: r.ok ? (r.message ?? 'Soumise.') : r.error });
      if (r.ok) router.refresh();
    });
  }

  const colonnes: ColonneTable<FactureMensuelle>[] = [
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
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Facture du mois</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {message && (
            <p
              className={
                message.ok
                  ? 'rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400'
                  : 'rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive'
              }
            >
              {message.texte}
            </p>
          )}
          {dejaSoumise ? (
            <p className="text-sm text-muted-foreground">
              La facture de {libellePeriode} a déjà été soumise — voir l’historique ci-dessous.
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <Button onClick={soumettre} disabled={pending}>
                {pending ? 'Soumission…' : `Soumettre la facture de ${libellePeriode}`}
              </Button>
              <p className="text-xs text-muted-foreground">
                Agrège toutes vos dispensations payées de {libellePeriode} — les lignes actuellement
                contestées en sont automatiquement exclues.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historique</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            donnees={factures}
            cleLigne={(f) => f.id}
            parPage={12}
            colonnes={colonnes}
            vide="Aucune facture mensuelle pour l’instant."
          />
        </CardContent>
      </Card>
    </div>
  );
}
