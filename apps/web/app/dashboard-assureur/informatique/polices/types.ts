/** Aperçu de proratisation renvoyé par POST /policy/polices/:id/avenants/simulation. */
export interface Simulation {
  type: string;
  dateEffet: string;
  periode: { dateDebut: string | null; dateFin: string | null };
  joursTotal: number | null;
  joursRestants: number | null;
  proratisationAppliquee: boolean;
  impactCotisation: string | null;
}
