'use client';

import { CalendarRange, PieChart, Pill, Store } from 'lucide-react';

import { CarteGraphique, COULEUR, GraphiqueAire, GraphiqueBarres, GraphiqueDonut } from '@/components/dashboard/graphiques';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const libelleMois = (cle: string) => {
  const [a, m] = cle.split('-');
  return `${MOIS[Number(m) - 1]} ${a.slice(2)}`;
};
const LIBELLE_STATUT: Record<string, string> = { EN_PREPARATION: 'En préparation', EN_ATTENTE_VALIDATION_PATIENT: 'En attente du patient', VALIDEE: 'Validée', PAYEE: 'Payée', ANNULEE: 'Annulée' };
const COULEUR_STATUT: Record<string, string> = { PAYEE: COULEUR.vert, VALIDEE: COULEUR.cyan, EN_ATTENTE_VALIDATION_PATIENT: COULEUR.ambre, EN_PREPARATION: '#94a3b8', ANNULEE: COULEUR.rose };

export interface DonneesGraphiquesDispensations {
  parMois: { mois: string; total: number; assurance: number }[];
  parStatut: { statut: string; n: number }[];
  parPharmacie: { nom: string; total: number }[];
  medicaments: { nom: string; montant: number }[];
}

/** Graphiques du rapport des dispensations : mêmes chiffres que les tableaux et que l'export. */
export function RapportDispensationsGraphiques({ donnees }: { donnees: DonneesGraphiquesDispensations }) {
  const mois = donnees.parMois.map((m) => ({ nom: libelleMois(m.mois), total: m.total, assurance: m.assurance }));
  const statuts = donnees.parStatut.map((s) => ({ nom: LIBELLE_STATUT[s.statut] ?? s.statut, valeur: s.n, couleur: COULEUR_STATUT[s.statut] }));
  const pharmacies = donnees.parPharmacie.slice(0, 8).map((p) => ({ nom: p.nom.length > 22 ? `${p.nom.slice(0, 21)}…` : p.nom, total: p.total }));
  const medicaments = donnees.medicaments.slice(0, 8).map((m) => ({ nom: m.nom.length > 24 ? `${m.nom.slice(0, 23)}…` : m.nom, montant: m.montant }));
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Graphiques du rapport">
      <CarteGraphique titre="Montant et part assurance par mois" description="Dispensations non annulées" icon={CalendarRange} couleur={COULEUR.indigo}>
        <GraphiqueAire monetaire donnees={mois} series={[{ cle: 'total', nom: 'Montant total', couleur: COULEUR.indigo }, { cle: 'assurance', nom: 'Part assurance', couleur: COULEUR.vert }]} />
      </CarteGraphique>
      <CarteGraphique titre="Dispensations par statut" description="Nombre de dispensations" icon={PieChart} couleur={COULEUR.ambre}>
        <GraphiqueDonut donnees={statuts} libelleTotal="dispensations" />
      </CarteGraphique>
      <CarteGraphique titre="Pharmacies : montant dispensé" description="Les pharmacies au plus gros montant" icon={Store} couleur={COULEUR.violet}>
        <GraphiqueBarres horizontal monetaire donnees={pharmacies} series={[{ cle: 'total', nom: 'Montant', couleur: COULEUR.violet }]} />
      </CarteGraphique>
      <CarteGraphique titre="Médicaments les plus délivrés" description="En montant" icon={Pill} couleur={COULEUR.cyan}>
        <GraphiqueBarres horizontal monetaire donnees={medicaments} series={[{ cle: 'montant', nom: 'Montant', couleur: COULEUR.cyan }]} />
      </CarteGraphique>
    </section>
  );
}
