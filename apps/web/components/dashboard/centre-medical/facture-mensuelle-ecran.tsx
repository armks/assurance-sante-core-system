'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { soumettreFactureMensuelleEtablissement } from '@/app/dashboard-centre-medical/facture-mensuelle/actions';
import { DataTable, StatutBadge, type ColonneTable } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatutActe } from './statut-acte';
import { useCategoriesActe } from '@/components/categories-acte';

export interface ActeDuMois {
  id: string;
  categorieActe: string;
  libelle: string;
  codeActe: string | null;
  montantPrescrit: string | null;
  statut: string;
  dateRealisation: string | null;
  statutPreautorisation: string;
  datePrescription: string;
  numeroTraitement: string;
  patient: string;
  dejaFacture: boolean;
  enLitige: boolean;
}
export interface FactureMensuelleEtablissement {
  id: string;
  periode: string;
  statut: string;
  montantTotal: string;
  dateSoumission: string | null;
  dateVerification: string | null;
  datePaiement: string | null;
}

const LIBELLE_STATUT: Record<string, string> = {
  EN_PREPARATION: 'En préparation',
  SOUMISE: 'Soumise — en attente du médecin conseil',
  VERIFIEE_MEDECIN_CONSEIL: 'Vérifiée par le médecin conseil',
  PROGRAMMEE_PAIEMENT: 'Paiement programmé',
  PAYEE: 'Payée',
};
const TON_STATUT: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  EN_PREPARATION: 'neutre',
  SOUMISE: 'attention',
  VERIFIEE_MEDECIN_CONSEIL: 'attention',
  PROGRAMMEE_PAIEMENT: 'attention',
  PAYEE: 'succes',
};

const montant = (v: string | null) => (v ? `${Number(v).toLocaleString('fr-FR')} F` : '—');
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');
const moisFr = (d: string) =>
  new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Premier jour du mois précédent — même logique que `PreauthorizationService.bornesMoisPrecedentEtablissement`. */
function periodePrecedente(): { iso: string; libelle: string } {
  const maintenant = new Date();
  const debut = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - 1, 1));
  return { iso: debut.toISOString().slice(0, 10), libelle: moisFr(debut.toISOString()) };
}

export function FactureMensuelleEtablissementEcran({
  actesDuMois,
  factures,
}: {
  actesDuMois: ActeDuMois[];
  factures: FactureMensuelleEtablissement[];
}) {
  const { libelle: libelleCategorieActe } = useCategoriesActe();
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [pending, start] = useTransition();

  const { iso: periodeAttendue, libelle: libellePeriode } = periodePrecedente();
  const dejaSoumise = factures.some((f) => f.periode.slice(0, 10) === periodeAttendue);

  function soumettre() {
    start(async () => {
      const r = await soumettreFactureMensuelleEtablissement(periodeAttendue);
      setMessage({ ok: r.ok, texte: r.ok ? (r.message ?? 'Soumise.') : r.error });
      if (r.ok) router.refresh();
    });
  }

  const colonnesActes: ColonneTable<ActeDuMois>[] = [
    { cle: 'patient', entete: 'Patient', triable: true },
    { cle: 'numeroTraitement', entete: 'Dossier' },
    {
      cle: 'categorieActe',
      entete: 'Catégorie',
      valeur: (a) => libelleCategorieActe(a.categorieActe),
      rendu: (a) => libelleCategorieActe(a.categorieActe),
    },
    { cle: 'libelle', entete: 'Acte' },
    {
      cle: 'montantPrescrit',
      entete: 'Montant',
      aligneDroite: true,
      valeur: (a) => Number(a.montantPrescrit ?? 0),
      rendu: (a) => montant(a.montantPrescrit),
    },
    {
      cle: 'datePrescription',
      entete: 'Prescrit le',
      triable: true,
      valeur: (a) => a.datePrescription,
      rendu: (a) => dateFr(a.datePrescription),
    },
    {
      cle: 'statut',
      entete: 'Réalisation',
      rendu: (a) => <StatutActe statut={a.statut} dateRealisation={a.dateRealisation} />,
    },
    {
      cle: 'etat',
      entete: 'État',
      rendu: (a) =>
        a.enLitige ? (
          <span className="text-xs text-destructive">En litige</span>
        ) : a.dejaFacture ? (
          <span className="text-xs text-muted-foreground">Déjà facturé</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  const colonnesFactures: ColonneTable<FactureMensuelleEtablissement>[] = [
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
          <CardTitle className="text-base">Actes du mois en cours ({moisFr(new Date().toISOString())})</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            donnees={actesDuMois}
            cleLigne={(a) => a.id}
            parPage={15}
            recherche={{ placeholder: 'Patient, dossier, acte…', champs: ['patient', 'numeroTraitement', 'libelle'] }}
            colonnes={colonnesActes}
            vide="Aucun acte enregistré ce mois-ci pour l’instant."
          />
        </CardContent>
      </Card>

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
                {pending ? 'Soumission…' : `Proposer la facture provisoire de ${libellePeriode}`}
              </Button>
              <p className="text-xs text-muted-foreground">
                Agrège tous les actes payés (code de facturation confirmé par le patient) de {libellePeriode} —
                les actes actuellement contestés en sont automatiquement exclus.
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
            colonnes={colonnesFactures}
            vide="Aucune facture mensuelle pour l’instant."
          />
        </CardContent>
      </Card>
    </div>
  );
}
