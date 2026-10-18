'use client';

import { Building2, CalendarRange, Layers, ShieldCheck } from 'lucide-react';

import {
  CarteGraphique,
  COULEUR,
  GraphiqueAire,
  GraphiqueBarres,
  GraphiqueDonut,
} from '@/components/dashboard/graphiques';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const libelleMois = (cle: string) => {
  const [a, m] = cle.split('-');
  return `${MOIS[Number(m) - 1]} ${a.slice(2)}`;
};
const COULEUR_PREAUTORISATION: Record<string, string> = {
  NON_REQUISE: COULEUR.cyan,
  EN_ATTENTE_EXPLOITATION: COULEUR.ambre,
  EN_ATTENTE_MEDECIN_CONSEIL: COULEUR.violet,
  APPROUVEE: COULEUR.vert,
  APPROUVEE_PARTIELLEMENT: COULEUR.indigo,
  REFUSEE: COULEUR.rose,
};

export interface DonneesGraphiquesActivite {
  parMois: { mois: string; dossiers: number; actes: number; cout: number; assurance: number }[];
  parCategorie: { categorie: string; actes: number; cout: number; assurance: number }[];
  parPreautorisation: { statut: string; n: number }[];
  parEtablissement: { nom: string; cout: number; assurance: number }[];
  libellesCategories: Record<string, string>;
  libellesPreautorisation: Record<string, string>;
}

/** Graphiques du rapport d'activité : mêmes chiffres que les tableaux et que l'export PDF / Word. */
export function RapportActiviteGraphiques({ donnees }: { donnees: DonneesGraphiquesActivite }) {
  const mois = donnees.parMois.map((m) => ({ nom: libelleMois(m.mois), cout: m.cout, assurance: m.assurance }));
  const categories = donnees.parCategorie.map((c) => ({ nom: donnees.libellesCategories[c.categorie] ?? c.categorie, valeur: c.cout }));
  const preauto = donnees.parPreautorisation.map((p) => ({
    nom: donnees.libellesPreautorisation[p.statut] ?? p.statut,
    valeur: p.n,
    couleur: COULEUR_PREAUTORISATION[p.statut],
  }));
  const etabs = donnees.parEtablissement.slice(0, 8).map((e) => ({ nom: e.nom.length > 20 ? `${e.nom.slice(0, 19)}…` : e.nom, cout: e.cout }));
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Graphiques du rapport">
      <CarteGraphique titre="Coût et part assurance par mois" description="Actes non refusés, selon la date d’ouverture du dossier" icon={CalendarRange} couleur={COULEUR.indigo}>
        <GraphiqueAire
          monetaire
          donnees={mois}
          series={[
            { cle: 'cout', nom: 'Coût total', couleur: COULEUR.indigo },
            { cle: 'assurance', nom: 'Part assurance', couleur: COULEUR.vert },
          ]}
        />
      </CarteGraphique>
      <CarteGraphique titre="Coût par catégorie d’acte" description="Répartition du coût total" icon={Layers} couleur={COULEUR.cyan}>
        <GraphiqueDonut donnees={categories} libelleTotal="FCFA" formatValeur={(n) => `${Math.round(n).toLocaleString('fr-FR')} F`} />
      </CarteGraphique>
      <CarteGraphique titre="Décisions de pré-autorisation" description="Nombre d’actes par décision" icon={ShieldCheck} couleur={COULEUR.violet}>
        <GraphiqueDonut donnees={preauto} libelleTotal="actes" />
      </CarteGraphique>
      <CarteGraphique titre="Établissements les plus coûteux" description="Coût total des actes" icon={Building2} couleur={COULEUR.ambre}>
        <GraphiqueBarres horizontal monetaire donnees={etabs} series={[{ cle: 'cout', nom: 'Coût total', couleur: COULEUR.ambre }]} />
      </CarteGraphique>
    </section>
  );
}
