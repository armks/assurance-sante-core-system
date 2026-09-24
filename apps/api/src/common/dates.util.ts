/**
 * Coupure « 1er du mois » — règle partagée par la facturation
 * (billing/, cotisations), les mouvements de personnel à effet différé
 * (member/import-adherents.service.ts, `moisEffet`) et la vue « actes du
 * mois » (preauthorization/). Toujours en UTC minuit pour éviter toute
 * dérive de fuseau horaire sur une frontière de mois. Factorisé le
 * 2026-09-24 (consolidation d'audit) — remplace 4 implémentations inline
 * équivalentes, aucun changement de comportement.
 */

/** Premier jour (UTC minuit) du mois de `d`. */
export function premierJourDuMois(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Premier jour (UTC minuit) du mois suivant `reference` (par défaut : maintenant). */
export function premierJourDuMoisSuivant(reference: Date = new Date()): Date {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1));
}
