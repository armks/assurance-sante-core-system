'use client';

import { BarChart3, CalendarRange, Landmark, PieChart, Wallet } from 'lucide-react';

import { CarteGraphique, COULEUR, GraphiqueBarres, GraphiqueDonut } from '@/components/dashboard/graphiques';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const libelleMois = (cle: string) => {
  const [a, m] = cle.split('-');
  return `${MOIS[Number(m) - 1]} ${a.slice(2)}`;
};
const francs = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;

const COULEUR_COTISATION: Record<string, string> = { PAYEE: COULEUR.vert, A_PAYER: COULEUR.ambre, EN_RETARD: COULEUR.rose, ANNULEE: COULEUR.violet };
const LIBELLE_COTISATION: Record<string, string> = { A_PAYER: 'À payer', PAYEE: 'Payée', EN_RETARD: 'En retard', ANNULEE: 'Annulée' };
const COULEUR_MOUVEMENT: Record<string, string> = { APPROVISIONNEMENT: COULEUR.vert, DEPENSE: COULEUR.rose, TRANSFERT: COULEUR.cyan, PAIEMENT_FACTURE: COULEUR.indigo };
const LIBELLE_MOUVEMENT: Record<string, string> = { APPROVISIONNEMENT: 'Approvisionnements', DEPENSE: 'Dépenses', TRANSFERT: 'Transferts', PAIEMENT_FACTURE: 'Paiements de factures' };

export interface DonneesGraphiquesCotisations {
  parMois: { mois: string; du: number; paye: number }[];
  parStatut: { statut: string; n: number }[];
  parSociete: { nom: string; du: number; paye: number }[];
}

/** Graphiques du rapport de cotisations : mêmes chiffres que les tableaux et que l'export. */
export function RapportCotisationsGraphiques({ donnees }: { donnees: DonneesGraphiquesCotisations }) {
  const mois = donnees.parMois.map((m) => ({ nom: libelleMois(m.mois), du: m.du, paye: m.paye }));
  const statuts = donnees.parStatut.map((s) => ({ nom: LIBELLE_COTISATION[s.statut] ?? s.statut, valeur: s.n, couleur: COULEUR_COTISATION[s.statut] }));
  const societes = donnees.parSociete.slice(0, 8).map((s) => ({ nom: s.nom.length > 20 ? `${s.nom.slice(0, 19)}…` : s.nom, du: s.du, paye: s.paye }));
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Graphiques du rapport">
      <CarteGraphique titre="Dû et encaissé par mois" description="Cotisations non annulées" icon={CalendarRange} couleur={COULEUR.indigo}>
        <GraphiqueBarres monetaire donnees={mois} series={[{ cle: 'du', nom: 'Dû', couleur: COULEUR.indigo }, { cle: 'paye', nom: 'Encaissé', couleur: COULEUR.vert }]} />
      </CarteGraphique>
      <CarteGraphique titre="Cotisations par statut" description="Nombre d’appels de cotisation" icon={PieChart} couleur={COULEUR.ambre}>
        <GraphiqueDonut donnees={statuts} libelleTotal="cotisations" />
      </CarteGraphique>
      <CarteGraphique titre="Sociétés : dû et encaissé" description="Les sociétés au plus gros montant dû" icon={BarChart3} couleur={COULEUR.violet} className="lg:col-span-2">
        <GraphiqueBarres horizontal monetaire donnees={societes} series={[{ cle: 'du', nom: 'Dû', couleur: COULEUR.violet }, { cle: 'paye', nom: 'Encaissé', couleur: COULEUR.vert }]} />
      </CarteGraphique>
    </section>
  );
}

export interface DonneesGraphiquesFinances {
  parMois: { mois: string; entrees: number; sorties: number }[];
  parType: { type: string; total: number }[];
  comptes: { nom: string; solde: number }[];
}

/** Graphiques du rapport financier : mêmes chiffres que les tableaux et que l'export. */
export function RapportFinancesGraphiques({ donnees }: { donnees: DonneesGraphiquesFinances }) {
  const mois = donnees.parMois.map((m) => ({ nom: libelleMois(m.mois), entrees: m.entrees, sorties: m.sorties }));
  const types = donnees.parType.map((t) => ({ nom: LIBELLE_MOUVEMENT[t.type] ?? t.type, valeur: t.total, couleur: COULEUR_MOUVEMENT[t.type] }));
  const comptes = donnees.comptes.map((c) => ({ nom: c.nom.length > 22 ? `${c.nom.slice(0, 21)}…` : c.nom, solde: c.solde }));
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Graphiques du rapport">
      <CarteGraphique titre="Entrées et sorties par mois" description="Approvisionnements, dépenses et paiements de factures" icon={CalendarRange} couleur={COULEUR.indigo}>
        <GraphiqueBarres monetaire donnees={mois} series={[{ cle: 'entrees', nom: 'Entrées', couleur: COULEUR.vert }, { cle: 'sorties', nom: 'Sorties', couleur: COULEUR.rose }]} />
      </CarteGraphique>
      <CarteGraphique titre="Montants par type de mouvement" description="Répartition sur la période" icon={Wallet} couleur={COULEUR.cyan}>
        <GraphiqueDonut donnees={types} libelleTotal="montant" formatValeur={francs} />
      </CarteGraphique>
      <CarteGraphique titre="Soldes des comptes" description="Solde actuel de chaque compte" icon={Landmark} couleur={COULEUR.ambre} className="lg:col-span-2">
        <GraphiqueBarres horizontal monetaire donnees={comptes} series={[{ cle: 'solde', nom: 'Solde', couleur: COULEUR.ambre }]} />
      </CarteGraphique>
    </section>
  );
}
