export type PeriodeRapide = 'jour' | 'semaine' | 'mois' | 'perso';

const jour = (d: Date) => d.toISOString().slice(0, 10);

export const PERIODES_RAPIDES: { valeur: PeriodeRapide; libelle: string }[] = [
  { valeur: 'jour', libelle: 'Aujourd’hui' },
  { valeur: 'semaine', libelle: 'Cette semaine' },
  { valeur: 'mois', libelle: 'Ce mois' },
  { valeur: 'perso', libelle: 'Entre deux dates' },
];

/** Période demandée dans l'URL (`jour` par défaut). */
export function periodeDemandee(v: string | undefined): PeriodeRapide {
  return v === 'semaine' || v === 'mois' || v === 'perso' ? v : 'jour';
}

/** Bornes (dates incluses, UTC = Abidjan) : jour, semaine du lundi au dimanche, mois en cours, ou dates libres. */
export function bornesPeriode(periode: PeriodeRapide, du?: string, au?: string): { du?: string; au?: string } {
  const n = new Date();
  if (periode === 'perso') return { du, au };
  if (periode === 'mois') {
    return {
      du: jour(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))),
      au: jour(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0))),
    };
  }
  if (periode === 'semaine') {
    const decalage = (n.getUTCDay() + 6) % 7; // lundi = 0
    const lundi = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - decalage));
    const dimanche = new Date(Date.UTC(lundi.getUTCFullYear(), lundi.getUTCMonth(), lundi.getUTCDate() + 6));
    return { du: jour(lundi), au: jour(dimanche) };
  }
  return { du: jour(n), au: jour(n) };
}
