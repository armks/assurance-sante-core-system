export interface PeriodeDossiers {
  du: string;
  au: string;
}

const dateIso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Premier et dernier jour du mois en cours. */
export function moisEnCoursPeriode(): PeriodeDossiers {
  const n = new Date();
  return { du: dateIso(new Date(n.getFullYear(), n.getMonth(), 1)), au: dateIso(new Date(n.getFullYear(), n.getMonth() + 1, 0)) };
}

type Param = string | string[] | undefined;

/**
 * Période demandée dans l'URL (`?du=&au=`) : absente → mois en cours ; présente mais vide → toute période.
 * Le serveur ne charge que cette période (au lieu de tous les dossiers puis filtrage dans le navigateur).
 */
export function periodeDepuisUrl(sp: { du?: Param; au?: Param }): PeriodeDossiers {
  const premier = (v: Param) => (Array.isArray(v) ? v[0] : v);
  const du = premier(sp.du);
  const au = premier(sp.au);
  if (du === undefined && au === undefined) return moisEnCoursPeriode();
  const valide = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  return { du: valide(du), au: valide(au) };
}

/** Chaîne de requête API correspondant à la période (paramètres vides omis) ; `allege` : liste sans le détail des dossiers. */
export function requetePeriode(p: PeriodeDossiers, allege = false): string {
  const q = new URLSearchParams();
  if (p.du) q.set('du', p.du);
  if (p.au) q.set('au', p.au);
  if (allege) q.set('allege', '1');
  const s = q.toString();
  return s ? `?${s}` : '';
}
