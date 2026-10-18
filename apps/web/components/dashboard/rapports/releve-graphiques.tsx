'use client';

import { CalendarRange, Layers, Users } from 'lucide-react';

import { CarteGraphique, COULEUR, GraphiqueBarres, GraphiqueDonut } from '@/components/dashboard/graphiques';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const libelleMois = (cle: string) => {
  const [a, m] = cle.split('-');
  return `${MOIS[Number(m) - 1]} ${a.slice(2)}`;
};

export interface DonneesReleve {
  parMois: { mois: string; assurance: number; resteACharge: number }[];
  parPersonne: { nom: string; cout: number }[];
  parCategorie: { categorie: string; cout: number }[];
  libellesCategories: Record<string, string>;
}

/** Graphiques du relevé de soins : mêmes chiffres que les tableaux et que l'export. */
export function ReleveGraphiques({ donnees }: { donnees: DonneesReleve }) {
  const mois = donnees.parMois.map((m) => ({ nom: libelleMois(m.mois), assurance: m.assurance, reste: m.resteACharge }));
  const personnes = donnees.parPersonne.map((p) => ({ nom: p.nom, valeur: p.cout }));
  const categories = donnees.parCategorie.map((c) => ({ nom: donnees.libellesCategories[c.categorie] ?? c.categorie, valeur: c.cout }));
  const francs = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Graphiques du relevé">
      <CarteGraphique titre="Pris en charge et reste à charge par mois" description="Soins en établissement" icon={CalendarRange} couleur={COULEUR.indigo} className="lg:col-span-2">
        <GraphiqueBarres monetaire empile donnees={mois} series={[{ cle: 'assurance', nom: 'Pris en charge', couleur: COULEUR.vert }, { cle: 'reste', nom: 'Reste à charge', couleur: COULEUR.rose }]} />
      </CarteGraphique>
      <CarteGraphique titre="Coût par personne couverte" description="Moi et mes bénéficiaires" icon={Users} couleur={COULEUR.violet}>
        <GraphiqueDonut donnees={personnes} libelleTotal="coût" formatValeur={francs} />
      </CarteGraphique>
      <CarteGraphique titre="Coût par catégorie d’acte" description="Répartition de mes soins" icon={Layers} couleur={COULEUR.cyan}>
        <GraphiqueDonut donnees={categories} libelleTotal="coût" formatValeur={francs} />
      </CarteGraphique>
    </section>
  );
}
