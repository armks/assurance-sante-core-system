/** Tarif proposé (ADR-008, lot 4) — rôles, statuts et libellés. */

/** L'établissement propose un montant pour un acte non tarifable : comptable ou administratif, jamais le médecin. */
export const ROLES_PROPOSITION_TARIF = ['CENTRE_MEDICAL_COMPTABLE', 'CENTRE_MEDICAL_ADMINISTRATIF'] as const;

/** Lecture côté assureur (la file et les décisions du médecin conseil arrivent au lot 5). */
export const ROLES_LECTURE_ASSUREUR_TARIF_PROPOSE = [
  'ASSUREUR_MEDECIN_CONSEIL',
  'ASSUREUR_DIRECTION',
  'ASSUREUR_INFORMATIQUE',
] as const;

export const STATUTS_TARIF_PROPOSE = ['PROPOSE', 'VALIDE', 'AJUSTE', 'REFUSE'] as const;
export type StatutTarifPropose = (typeof STATUTS_TARIF_PROPOSE)[number];

/** Montant maximal d'une proposition (garde-fou de saisie). */
export const MONTANT_PROPOSE_MAX = 1_000_000_000;

/** Mention affichée au patient pour un acte dont le tarif est proposé et non encore décidé. */
export const MENTION_TARIF_EN_EXAMEN = 'tarif en cours d’examen';
