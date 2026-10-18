'use client';

import { Building2, CalendarRange, PieChart, Stethoscope } from 'lucide-react';

import { CarteGraphique, COULEUR, GraphiqueBarres, GraphiqueDonut } from '@/components/dashboard/graphiques';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const libelleMois = (cle: string) => {
  const [a, m] = cle.split('-');
  return `${MOIS[Number(m) - 1]} ${a.slice(2)}`;
};
const COULEUR_STATUT: Record<string, string> = {
  PAYEE: COULEUR.vert,
  PARTIELLEMENT_REGLEE: COULEUR.cyan,
  PAIEMENT_PROGRAMME: COULEUR.indigo,
  PROGRAMMEE_PAIEMENT: COULEUR.violet,
  VERIFIEE_MEDECIN_CONSEIL: COULEUR.ambre,
  VALIDEE_PHARMACIEN_CONSEIL: COULEUR.ambre,
  SOUMISE: COULEUR.rose,
  EN_PREPARATION: '#94a3b8',
};

export interface DonneesGraphiquesFacturation {
  parMois: { mois: string; total: number; paye: number }[];
  parStatut: { statut: string; total: number }[];
  parType: { type: string; total: number }[];
  parPrestataire: { nom: string; total: number; paye: number }[];
  libellesStatuts: Record<string, string>;
}

/** Graphiques du rapport de facturation mensuelle : mêmes chiffres que les tableaux et que l'export. */
export function RapportFacturationGraphiques({ donnees }: { donnees: DonneesGraphiquesFacturation }) {
  const mois = donnees.parMois.map((m) => ({ nom: libelleMois(m.mois), total: m.total, paye: m.paye }));
  const statuts = donnees.parStatut.map((s) => ({ nom: donnees.libellesStatuts[s.statut] ?? s.statut, valeur: s.total, couleur: COULEUR_STATUT[s.statut] }));
  const types = donnees.parType.map((t) => ({ nom: t.type === 'PHARMACIE' ? 'Pharmacies' : 'Établissements', valeur: t.total, couleur: t.type === 'PHARMACIE' ? COULEUR.vert : COULEUR.indigo }));
  const prestataires = donnees.parPrestataire.slice(0, 8).map((p) => ({ nom: p.nom.length > 20 ? `${p.nom.slice(0, 19)}…` : p.nom, total: p.total, paye: p.paye }));
  const francs = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Graphiques du rapport">
      <CarteGraphique titre="Facturé et payé par mois" description="Montants des factures mensuelles" icon={CalendarRange} couleur={COULEUR.indigo}>
        <GraphiqueBarres monetaire donnees={mois} series={[{ cle: 'total', nom: 'Facturé', couleur: COULEUR.indigo }, { cle: 'paye', nom: 'Payé', couleur: COULEUR.vert }]} />
      </CarteGraphique>
      <CarteGraphique titre="Montants par statut" description="Où en sont les paiements" icon={PieChart} couleur={COULEUR.violet}>
        <GraphiqueDonut donnees={statuts} libelleTotal="facturé" formatValeur={francs} />
      </CarteGraphique>
      <CarteGraphique titre="Établissements et pharmacies" description="Répartition du montant facturé" icon={Stethoscope} couleur={COULEUR.vert}>
        <GraphiqueDonut donnees={types} libelleTotal="facturé" formatValeur={francs} />
      </CarteGraphique>
      <CarteGraphique titre="Prestataires les plus facturés" description="Facturé et payé" icon={Building2} couleur={COULEUR.ambre}>
        <GraphiqueBarres horizontal monetaire donnees={prestataires} series={[{ cle: 'total', nom: 'Facturé', couleur: COULEUR.ambre }, { cle: 'paye', nom: 'Payé', couleur: COULEUR.vert }]} />
      </CarteGraphique>
    </section>
  );
}
