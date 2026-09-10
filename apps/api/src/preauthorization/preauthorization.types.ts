export const STATUTS_CODE_CONSULTATION = [
  'EMIS',
  'CONFIRME_PATIENT',
  'UTILISE_ETABLISSEMENT',
  'EXPIRE',
  'ANNULE',
] as const;
export type StatutCodeConsultation =
  (typeof STATUTS_CODE_CONSULTATION)[number];

/** Rôles autorisés à demander un code de consultation (pour eux-mêmes). */
export const ROLES_ADHERENT = [
  'ADHERENT_TITULAIRE',
  'SOUSCRIPTEUR_INDIVIDUEL',
] as const;

/**
 * Alphabet du code : majuscules + chiffres, sans caractères ambigus
 * (0/O, 1/I/L). 30 symboles → 30^8 ≈ 6,5·10¹¹ combinaisons pour une fenêtre de
 * 48 h : non devinable par force brute.
 */
export const ALPHABET_CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LONGUEUR_CODE = 8;

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  role: string | null;
  adherentId: string | null;
  roleChain: string[];
}
