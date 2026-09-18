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
  'CENTRE_MEDICAL_COMPTABLE',
] as const;

// --- Code de Facturation (v8 §5) — 4e et dernier code anti-fraude ------

export const STATUTS_FACTURE = [
  'EMISE',
  'EN_VALIDATION',
  'VALIDEE',
  'REGLEE',
  'CONTESTEE',
] as const;
export type StatutFacture = (typeof STATUTS_FACTURE)[number];

/**
 * Rôles habilités à générer une facture d'un ticket clôturé. Côté ASSUREUR
 * (exploitation / comptable / informatique) et côté ÉTABLISSEMENT (comptable /
 * administratif du centre — soumis au contrôle d'établissement, cf.
 * `ROLES_CENTRE_MEDICAL`). Les garde-fous anti-fraude restent intacts : montants
 * calculés côté serveur depuis les actes + garanties, code de facturation
 * transmis à l'adhérent (jamais à l'établissement), et confirmation de paiement
 * réservée à `ASSUREUR_COMPTABLE`.
 */
export const ROLES_GENERATION_FACTURE = [
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_COMPTABLE',
  'ASSUREUR_INFORMATIQUE',
  'CENTRE_MEDICAL_COMPTABLE',
  'CENTRE_MEDICAL_ADMINISTRATIF',
] as const;

/** La confirmation de paiement est réservée à ASSUREUR_COMPTABLE (v8 §5). */
export const ROLE_CONFIRMATION_PAIEMENT = 'ASSUREUR_COMPTABLE';

/**
 * Tâche de maintenance déclenchée à la main (pas de scheduler dans ce
 * backend — même pattern que `ProviderService.reverifierObsoletes`) : réservée
 * à ASSUREUR_INFORMATIQUE, comme les autres tâches réseau de ce type.
 */
export const ROLE_MAINTENANCE_EXPIRATION = 'ASSUREUR_INFORMATIQUE';

// --- Pré-autorisation obligatoire (analyses / examens médicaux) --------

export const STATUTS_PREAUTORISATION = [
  'NON_REQUISE',
  'EN_ATTENTE_VALIDATION',
  'APPROUVEE',
  'REFUSEE',
] as const;
export type StatutPreautorisation = (typeof STATUTS_PREAUTORISATION)[number];

/**
 * Type de visite (care-episode) qui déclenche AUTOMATIQUEMENT le passage en
 * `EN_ATTENTE_VALIDATION` à l'ajout d'un acte — décidé côté serveur depuis
 * `dossier.typeVisite` réel, jamais depuis une valeur envoyée par le client.
 */
export const TYPE_VISITE_PREAUTORISATION_OBLIGATOIRE = 'ANALYSES_EXAMENS_MEDICAUX';

/**
 * Statuts qui EXCLUENT un acte de toute facturation/paiement — appliqué dans
 * `calculerMontants` (génération de facture) et à réutiliser tel quel par tout
 * futur mécanisme de paiement par acte (Prompt 3, pas encore construit).
 */
export const STATUTS_PREAUTORISATION_NON_FACTURABLES = [
  'EN_ATTENTE_VALIDATION',
  'REFUSEE',
] as const;

/**
 * La validation d'une pré-autorisation d'analyse est réservée EXCLUSIVEMENT
 * à ASSUREUR_MEDECIN_CONSEIL — jamais ASSUREUR_INFORMATIQUE ni
 * ASSUREUR_EXPLOITATION (même séparation que `ROLE_HOMOLOGATION_ACTE`,
 * module reference/).
 */
export const ROLE_VALIDATION_PREAUTORISATION = 'ASSUREUR_MEDECIN_CONSEIL';

/** Taux de couverture par défaut si aucune garantie ne matche la catégorie d'acte. */
export const TAUX_COUVERTURE_DEFAUT = 80;

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
