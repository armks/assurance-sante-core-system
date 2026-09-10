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

// --- Code Référence d'Ordonnance (v8 §3) --------------------------------

export const STATUTS_CODE_ORDONNANCE = [
  'EMIS',
  'PRESENTE_PHARMACIE',
  'UTILISE_PARTIEL',
  'UTILISE_COMPLET',
  'EXPIRE',
  'ANNULE',
] as const;
export type StatutCodeOrdonnance = (typeof STATUTS_CODE_ORDONNANCE)[number];

export const STATUTS_ORDONNANCE = [
  'ACTIVE',
  'PARTIELLEMENT_DELIVREE',
  'COMPLETEMENT_DELIVREE',
  'EXPIREE',
  'ANNULEE',
] as const;
export type StatutOrdonnance = (typeof STATUTS_ORDONNANCE)[number];

export const ROLE_MEDECIN_TRAITANT = 'CENTRE_MEDICAL_MEDECIN';

/** Rôles côté pharmacie autorisés à saisir un code d'ordonnance. */
export const ROLES_PHARMACIE = [
  'PHARMACIE_PHARMACIEN',
  'PHARMACIE_CAISSIERE',
  'PHARMACIE_COMPTABLE',
] as const;

// --- Ticket de Soins (v8 §4) -------------------------------------------

export const STATUTS_TICKET_SOINS = ['OUVERT', 'CLOTURE', 'ANNULE'] as const;
export type StatutTicketSoins = (typeof STATUTS_TICKET_SOINS)[number];

export const CATEGORIES_ACTE = [
  'CONSULTATION',
  'HOSPITALISATION',
  'PHARMACIE',
  'OPTIQUE',
  'DENTAIRE',
  'IMAGERIE',
  'BIOLOGIE',
  'ACTE_TECHNIQUE',
  'TRANSPORT',
  'AUTRE',
] as const;

/** Rôles autorisés à ajouter un acte à un ticket de soins. */
export const ROLES_AJOUT_ACTE = [
  'CENTRE_MEDICAL_MEDECIN',
  'CENTRE_MEDICAL_ACCUEIL',
  'CENTRE_MEDICAL_ADMINISTRATIF',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_INFORMATIQUE',
] as const;

/** Rôles « personnel de centre médical » — soumis au contrôle d'établissement. */
export const ROLES_CENTRE_MEDICAL = [
  'CENTRE_MEDICAL_MEDECIN',
  'CENTRE_MEDICAL_ACCUEIL',
  'CENTRE_MEDICAL_ADMINISTRATIF',
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
  etablissementId: string | null;
  pharmacieId: string | null;
  roleChain: string[];
}
