'use client';

import { Coins, HandCoins, ReceiptText, ShieldCheck } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import type { DispensationResume, RecapDispensations } from '@/app/dashboard-pharmacie/dispensation-types';
import {
  CarteResume,
  DataTable,
  GrilleCartes,
  PaginationServeur,
  StatutBadge,
  type ColonneTable,
  type PageServeur,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const LIBELLE_STATUT: Record<string, string> = {
  EN_PREPARATION: 'En préparation',
  EN_ATTENTE_VALIDATION_PATIENT: 'En attente de validation',
  VALIDEE: 'Validée par le patient',
  PAYEE: 'Payée',
  ANNULEE: 'Annulée',
};

const PERIODES = [
  { valeur: 'jour', libelle: 'Aujourd’hui' },
  { valeur: 'semaine', libelle: 'Cette semaine' },
  { valeur: 'mois', libelle: 'Ce mois' },
  { valeur: 'perso', libelle: 'Entre deux dates' },
];

const CLASSE_CHAMP =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

const montantFr = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;
const dateFr = (d: string) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Suivi des factures de prescription de la pharmacie : filtres (n° de carte, société, formule, période jour / semaine /
 * mois ou libre, statut) écrits dans l'URL et appliqués côté serveur, récapitulatif cumulé sur TOUT le périmètre filtré
 * (coût total, part assurance, part assuré) et tableau paginé qui montre toujours ces trois montants.
 */
export function FacturesSuiviEcran({
  factures,
  recap,
  periode,
}: {
  factures: PageServeur<DispensationResume>;
  recap: RecapDispensations | null;
  /** Période effective (jour par défaut). */
  periode: string;
}) {
  const router = useRouter();
  const chemin = usePathname();
  const params = useSearchParams();
  const [enCours, demarrer] = useTransition();
  const actuel = (k: string) => params.get(k) ?? '';

  const appliquer = (modifs: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    p.delete('page');
    for (const [k, v] of Object.entries(modifs)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    demarrer(() => router.push(qs ? `${chemin}?${qs}` : chemin, { scroll: false }));
  };

  const colonnes: ColonneTable<DispensationResume>[] = [
    { cle: 'datePreparation', entete: 'Date', rendu: (d) => dateFr(d.datePreparation) },
    {
      cle: 'patient',
      entete: 'Patient',
      rendu: (d) =>
        d.patient ? (
          <div className="leading-tight">
            <p className="font-medium">
              {d.patient.prenom} {d.patient.nom}
            </p>
            <p className="font-mono text-xs text-muted-foreground">{d.patient.numeroCarte}</p>
          </div>
        ) : (
          '—'
        ),
    },
    { cle: 'societe', entete: 'Société', rendu: (d) => d.societe ?? '—' },
    { cle: 'formule', entete: 'Formule', rendu: (d) => d.formule ?? '—' },
    {
      cle: 'medicaments',
      entete: 'Médicaments',
      rendu: (d) => (
        <span title={d.lignes.map((l) => `${l.denominationMedicament} × ${l.quantite}`).join('\n')}>{d.lignes.length}</span>
      ),
    },
    {
      cle: 'montantTotal',
      entete: 'Coût',
      aligneDroite: true,
      valeur: (d) => Number(d.montantTotal),
      rendu: (d) => <span className="font-semibold">{montantFr(d.montantTotal)}</span>,
    },
    {
      cle: 'montantAssurance',
      entete: 'Part assurance',
      aligneDroite: true,
      valeur: (d) => Number(d.montantAssurance),
      rendu: (d) => <span className="text-emerald-700 dark:text-emerald-400">{montantFr(d.montantAssurance)}</span>,
    },
    {
      cle: 'montantPatient',
      entete: 'Part assuré',
      aligneDroite: true,
      valeur: (d) => Number(d.montantPatient),
      rendu: (d) => montantFr(d.montantPatient),
    },
    { cle: 'statut', entete: 'Statut', rendu: (d) => <StatutBadge statut={d.statut} libelles={LIBELLE_STATUT} /> },
  ];

  const filtresActifs = ['carte', 'societe', 'formule', 'statut', 'periode', 'du', 'au'].some((k) => actuel(k));

  return (
    <div className="space-y-4">
      <form
        key={params.toString()}
        className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap sm:overflow-x-auto"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const val = (k: string) => String(fd.get(k) ?? '').trim() || null;
          // Deux dates saisies (ou l'une des deux) : elles l'emportent sur la période rapide.
          const du = val('du');
          const au = val('au');
          const per = du || au ? 'perso' : val('periode') === 'perso' ? 'jour' : val('periode');
          appliquer({
            carte: val('carte'),
            societe: val('societe'),
            formule: val('formule'),
            statut: val('statut'),
            periode: per === 'jour' ? null : per,
            du: per === 'perso' ? du : null,
            au: per === 'perso' ? au : null,
          });
        }}
      >
        <Input name="carte" defaultValue={actuel('carte')} placeholder="N° de carte" aria-label="N° de carte" className="h-9 min-w-32 flex-1 px-2 font-mono" />
        <Input name="societe" defaultValue={actuel('societe')} placeholder="Société" aria-label="Société" className="h-9 min-w-32 flex-1 px-2" />
        <Input name="formule" defaultValue={actuel('formule')} placeholder="Formule" aria-label="Formule" className="h-9 min-w-32 flex-1 px-2" />
        <select name="periode" aria-label="Période" defaultValue={periode} className={`${CLASSE_CHAMP} shrink-0`}>
          {PERIODES.map((p) => (
            <option key={p.valeur} value={p.valeur}>
              {p.libelle}
            </option>
          ))}
        </select>
        <label className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
          Du
          <input name="du" type="date" defaultValue={actuel('du')} max={actuel('au') || undefined} className={`${CLASSE_CHAMP} w-[8.5rem]`} />
        </label>
        <label className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
          au
          <input name="au" type="date" defaultValue={actuel('au')} min={actuel('du') || undefined} className={`${CLASSE_CHAMP} w-[8.5rem]`} />
        </label>
        <select name="statut" aria-label="Statut" defaultValue={actuel('statut')} className={`${CLASSE_CHAMP} shrink-0`}>
          <option value="">Hors annulées</option>
          {Object.entries(LIBELLE_STATUT).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" className="shrink-0" disabled={enCours}>
          {enCours ? 'Recherche…' : 'Appliquer'}
        </Button>
        {filtresActifs && (
          <Button type="button" size="sm" variant="ghost" className="shrink-0" disabled={enCours} onClick={() => demarrer(() => router.push(chemin, { scroll: false }))}>
            Réinitialiser
          </Button>
        )}
      </form>

      <GrilleCartes>
        <CarteResume libelle="Factures" valeur={recap?.nombre ?? '—'} icon={ReceiptText} />
        <CarteResume libelle="Coût total" valeur={recap ? montantFr(recap.montantTotal) : '—'} icon={Coins} />
        <CarteResume libelle="Part assurance" valeur={recap ? montantFr(recap.montantAssurance) : '—'} icon={ShieldCheck} />
        <CarteResume libelle="Part assuré" valeur={recap ? montantFr(recap.montantPatient) : '—'} icon={HandCoins} />
      </GrilleCartes>

      <DataTable
        donnees={factures.items}
        cleLigne={(d) => d.id}
        parPage={0}
        piedMasque
        colonnes={colonnes}
        vide="Aucune facture ne correspond à ces critères."
      />
      <PaginationServeur page={factures.page} pages={factures.pages} total={factures.total} limite={factures.limite} />
    </div>
  );
}
