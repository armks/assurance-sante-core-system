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

/** Décision sur un tarif proposé : réservée au médecin conseil (jamais le proposant, jamais l'établissement). */
export const ROLES_DECISION_TARIF = ['ASSUREUR_MEDECIN_CONSEIL'] as const;

/** File « Tarifs proposés à examiner » : médecin conseil ; direction en lecture (escalade). */
export const ROLES_FILE_TARIF_PROPOSE = ['ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_DIRECTION'] as const;

/** Rappels et escalade, déclenchables à la main. */
export const ROLES_RAPPELS_TARIF_PROPOSE = ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_DIRECTION', 'ASSUREUR_MEDECIN_CONSEIL'] as const;

export type ActionDecision = 'VALIDER' | 'AJUSTER' | 'REFUSER';

/** Paramètres de plateforme (parametres_plateforme) et valeurs par défaut. */
export const CLE_ECART_MEDIANE = 'tarif_propose_alerte_ecart_mediane_pourcent';
export const DEFAUT_ECART_MEDIANE = 50;
export const CLE_RECURRENCE_NOMBRE = 'tarif_propose_recurrence_nombre';
export const DEFAUT_RECURRENCE_NOMBRE = 5;
export const CLE_RECURRENCE_JOURS = 'tarif_propose_recurrence_jours';
export const DEFAUT_RECURRENCE_JOURS = 30;
export const CLE_RAPPEL_JOURS = 'tarif_propose_rappel_jours';
export const DEFAUT_RAPPEL_JOURS = 2;
export const CLE_ESCALADE_JOURS = 'tarif_propose_escalade_jours';
export const DEFAUT_ESCALADE_JOURS = 5;
