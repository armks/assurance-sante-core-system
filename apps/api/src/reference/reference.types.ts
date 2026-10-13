/** Statuts de gouvernance d'homologation (v8 §10). */
export const STATUTS_HOMOLOGATION = [
  'PROPOSE',
  'HOMOLOGUE',
  'SUSPENDU',
  'RETIRE',
] as const;
export type StatutHomologation = (typeof STATUTS_HOMOLOGATION)[number];

export const USAGES_MEDICAMENT = [
  'AMBULATOIRE',
  'HOSPITALIER',
  'LES_DEUX',
] as const;
export type UsageMedicament = (typeof USAGES_MEDICAMENT)[number];

/** Rôle autorisé à PROPOSER / modifier un élément au statut PROPOSE. */
export const ROLE_PROPOSITION = 'ASSUREUR_INFORMATIQUE';

/**
 * Rôles autorisés à HOMOLOGUER — un seul par référentiel, sans recouvrement
 * possible (v8 §10.2). C'est le croisement qui doit rester étanche :
 *  - un acte ne peut être homologué QUE par ASSUREUR_MEDECIN_CONSEIL ;
 *  - un médicament QUE par ASSUREUR_PHARMACIEN_CONSEIL.
 */
export const ROLE_HOMOLOGATION_ACTE = 'ASSUREUR_MEDECIN_CONSEIL';
export const ROLE_HOMOLOGATION_MEDICAMENT = 'ASSUREUR_PHARMACIEN_CONSEIL';

/**
 * ADR-009 — le référentiel médical de l'assureur est le catalogue national : l'ACTIVATION / DÉSACTIVATION d'un acte ou d'un médicament
 * homologué est ouverte à ces trois rôles de l'assureur, et à eux seuls (actes comme médicaments).
 */
export const ROLES_ACTIVATION_REFERENTIEL = [
  'ASSUREUR_INFORMATIQUE',
  'ASSUREUR_MEDECIN_CONSEIL',
  'ASSUREUR_PHARMACIEN_CONSEIL',
] as const;

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  roleChain: string[];
}
