/**
 * Types du module `pharmacy/` — révision majeure du flux pharmacie
 * (clarification métier) : verrou PAR LIGNE de médicament, pas par ordonnance
 * entière (PROMPT 19). `codes_ordonnance`/`validerCodeOrdonnance` (module
 * preauthorization/) restent en place, inchangés — ce module les remplace en
 * pratique pour le vrai flux de dispensation, sans les supprimer.
 */

/** Les 3 sous-rôles PHARMACIE ont des droits identiques sauf mention contraire
 * explicite (vérifié à l'audit du dashboard pharmacie). */
export const ROLES_PHARMACIE = [
  'PHARMACIE_PHARMACIEN',
  'PHARMACIE_CAISSIERE',
  'PHARMACIE_COMPTABLE',
] as const;

/** Gestion du stock (prix/disponibilité) et modification d'une ordonnance :
 * réservées explicitement au seul pharmacien (clarification métier). */
export const ROLE_PHARMACIEN_SEUL = 'PHARMACIE_PHARMACIEN';

export const ROLES_ADHERENT = ['ADHERENT_TITULAIRE', 'SOUSCRIPTEUR_INDIVIDUEL'] as const;

export const STATUTS_LIGNE_ORDONNANCE = ['DISPONIBLE', 'SERVIE'] as const;
export type StatutLigneOrdonnance = (typeof STATUTS_LIGNE_ORDONNANCE)[number];

export const STATUTS_DISPENSATION = [
  'EN_PREPARATION',
  'EN_ATTENTE_VALIDATION_PATIENT',
  'VALIDEE',
  'PAYEE',
  'ANNULEE',
] as const;
export type StatutDispensation = (typeof STATUTS_DISPENSATION)[number];

/** Une substitution de médicament n'est possible qu'avant confirmation du
 * paiement — une fois VALIDEE (code confirmé par le patient) ou PAYEE, le
 * contenu communiqué au patient ne peut plus changer sous silence. */
export const STATUTS_DISPENSATION_MODIFIABLE = [
  'EN_PREPARATION',
  'EN_ATTENTE_VALIDATION_PATIENT',
] as const;

/** Alphabet du code — identique aux 4 codes anti-fraude déjà construits (v8). */
export const ALPHABET_CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LONGUEUR_CODE = 8;

/** Catégorie d'acte utilisée pour résoudre la garantie applicable à une dispensation. */
export const CATEGORIE_ACTE_PHARMACIE = 'PHARMACIE';

/**
 * Plus de taux par défaut : un produit sans garantie PHARMACIE ne couvre pas la
 * dispensation (part assurance 0) — règle « non couvert », prisma/sql/067.
 */

/**
 * Rôles autorisés à soumettre la facture mensuelle d'une pharmacie — jamais
 * la caissière (même liste que `ROLES_JUSTIFICATION_PHARMACIE`, module
 * contestation/, dupliquée ici pour ne pas faire dépendre `pharmacy/` de
 * `contestation/` sur autre chose que la lecture des litiges).
 */
export const ROLES_FACTURATION_MENSUELLE = ['PHARMACIE_PHARMACIEN', 'PHARMACIE_COMPTABLE'] as const;

export const STATUTS_FACTURE_MENSUELLE = [
  'EN_PREPARATION',
  'SOUMISE',
  'VALIDEE_PHARMACIEN_CONSEIL',
  'PROGRAMMEE_PAIEMENT',
  /** Paiement réel programmé à une date future — voir `payment/payment.service.ts` `payerFacture`. */
  'PAIEMENT_PROGRAMME',
  /** Paiement réel partiel déjà effectué (`montantPaye` < `montantTotal`). */
  'PARTIELLEMENT_REGLEE',
  'PAYEE',
] as const;
export type StatutFactureMensuelle = (typeof STATUTS_FACTURE_MENSUELLE)[number];

export const ROLE_COMPTABLE_FACTURE_MENSUELLE = 'ASSUREUR_COMPTABLE';

/**
 * Décision de ASSUREUR_PHARMACIEN_CONSEIL sur une facture mensuelle SOUMISE —
 * même contrat que `DECISIONS_VERIFICATION_FACTURE_MENSUELLE_ETABLISSEMENT`
 * (module preauthorization/) : VALIDEE fait progresser le statut, A_CORRIGER
 * libère les lignes et repasse la facture en EN_PREPARATION.
 */
export const DECISIONS_VALIDATION_FACTURE_MENSUELLE_PHARMACIE = ['VALIDEE', 'A_CORRIGER'] as const;
export type DecisionValidationFactureMensuellePharmacie =
  (typeof DECISIONS_VALIDATION_FACTURE_MENSUELLE_PHARMACIE)[number];

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  role: string | null;
  roleChain: string[];
  pharmacieId: string | null;
  adherentId: string | null;
}
