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

// --- Pré-autorisation obligatoire à DEUX niveaux (analyses/examens,
// hospitalisation) — restructuré depuis le circuit à un niveau du Prompt
// précédent : ASSUREUR_EXPLOITATION statue en premier, seule l'escalade
// alimente la file du médecin conseil. -----------------------------------

export const STATUTS_PREAUTORISATION = [
  'NON_REQUISE',
  'EN_ATTENTE_EXPLOITATION',
  'EN_ATTENTE_MEDECIN_CONSEIL',
  'APPROUVEE',
  'APPROUVEE_PARTIELLEMENT',
  'REFUSEE',
] as const;
export type StatutPreautorisation = (typeof STATUTS_PREAUTORISATION)[number];

/**
 * Types de visite (care-episode) qui déclenchent AUTOMATIQUEMENT le passage
 * en `EN_ATTENTE_EXPLOITATION` à l'ajout d'un acte — décidé côté serveur
 * depuis `dossier.typeVisite` réel, jamais depuis une valeur envoyée par le
 * client.
 */
export const TYPES_VISITE_PREAUTORISATION_OBLIGATOIRE = [
  'ANALYSES_EXAMENS_MEDICAUX',
  'HOSPITALISATION_MEDICALE',
] as const;

/**
 * Statuts qui EXCLUENT un acte de toute facturation/paiement — appliqué dans
 * `calculerMontants`/`genererFactureSelection`. `APPROUVEE_PARTIELLEMENT`
 * reste facturable : le montant simulé reflète déjà la base approuvée
 * (recalculée), pas la demande initiale.
 */
export const STATUTS_PREAUTORISATION_NON_FACTURABLES = [
  'EN_ATTENTE_EXPLOITATION',
  'EN_ATTENTE_MEDECIN_CONSEIL',
  'REFUSEE',
] as const;

/**
 * Premier niveau — ASSUREUR_EXPLOITATION(_CONJOINTE) exclusivement (pas
 * ASSUREUR_INFORMATIQUE, pas ASSUREUR_MEDECIN_CONSEIL). Décide APPROUVE/
 * REFUSE directement, ou ESCALADE_MEDECIN_CONSEIL vers le second niveau.
 */
export const ROLES_TRAITEMENT_EXPLOITATION = [
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_EXPLOITATION_CONJOINTE',
] as const;

export const DECISIONS_EXPLOITATION_PREAUTORISATION = [
  'APPROUVE',
  'REFUSE',
  'ESCALADE_MEDECIN_CONSEIL',
] as const;
export type DecisionExploitationPreautorisation =
  (typeof DECISIONS_EXPLOITATION_PREAUTORISATION)[number];

/**
 * Second niveau — ASSUREUR_MEDECIN_CONSEIL exclusivement (jamais
 * ASSUREUR_INFORMATIQUE ni ASSUREUR_EXPLOITATION), atteint UNIQUEMENT par
 * escalade depuis le premier niveau (même séparation que
 * `ROLE_HOMOLOGATION_ACTE`, module reference/).
 */
export const ROLE_VALIDATION_PREAUTORISATION = 'ASSUREUR_MEDECIN_CONSEIL';

/**
 * Règle anti-répétition (14 jours) — appliquée uniquement aux actes ajoutés
 * dans un dossier dont le `typeVisite` est ANALYSES_EXAMENS_MEDICAUX (même
 * valeur que `TYPES_VISITE_PREAUTORISATION_OBLIGATOIRE`, pas une
 * `categorieActe` : celles-ci restent BIOLOGIE/IMAGERIE/etc.), et seulement
 * s'ils portent un `codeActe` (rien à comparer sinon — le même code désigne
 * toujours le même `referentiel_acte_id`). Seul ASSUREUR_MEDECIN_CONSEIL peut
 * débloquer, au cas par cas (`autoriserRepetition`), jamais l'exploitation
 * elle-même.
 */
export const TYPE_VISITE_ANTI_REPETITION = 'ANALYSES_EXAMENS_MEDICAUX';
export const JOURS_ANTI_REPETITION = 14;
export const ROLE_AUTORISATION_REPETITION = 'ASSUREUR_MEDECIN_CONSEIL';

/**
 * Règle de fréquence des consultations (14 jours, même fenêtre que la règle
 * ci-dessus) — appliquée à l'ajout d'un acte dans un dossier dont le
 * `typeVisite` est CONSULTATION_GENERALISTE ou CONSULTATION_SPECIALISTE :
 * bloque si un AUTRE dossier du MÊME `typeVisite` (compteurs strictement
 * séparés généraliste/spécialiste — une consultation d'un type n'affecte
 * jamais l'autre) existe déjà pour ce patient dans les 14 jours, tous
 * établissements confondus. `dateOuverture` du dossier fait foi (un dossier
 * de ce type n'existe que parce qu'une consultation de ce type a eu lieu).
 * Débloqué au cas par cas par ASSUREUR_MEDECIN_CONSEIL
 * (`autoriserRepetitionConsultation`), jamais l'exploitation — décision
 * actée après revue explicite du risque (un patient peut légitimement
 * consulter deux fois en 14 jours pour des motifs sans rapport).
 */
export const TYPES_VISITE_FREQUENCE_CONSULTATION = [
  'CONSULTATION_GENERALISTE',
  'CONSULTATION_SPECIALISTE',
] as const;
export const JOURS_FREQUENCE_CONSULTATION = 14;

// --- Consolidation mensuelle des factures établissement — miroir de
// FactureMensuellePharmacie (pharmacy.types.ts), adapté à l'établissement.
// -------------------------------------------------------------------------

/**
 * Rôles autorisés à soumettre la facture mensuelle d'un établissement —
 * ni CENTRE_MEDICAL_MEDECIN ni CENTRE_MEDICAL_ACCUEIL (plus étroit que
 * `ROLES_CENTRE_MEDICAL` : seule la fonction comptable/administrative
 * soumet, jamais le personnel médical ou l'accueil).
 */
export const ROLES_FACTURATION_MENSUELLE_ETABLISSEMENT = [
  'CENTRE_MEDICAL_COMPTABLE',
  'CENTRE_MEDICAL_ADMINISTRATIF',
] as const;

export const STATUTS_FACTURE_MENSUELLE_ETABLISSEMENT = [
  'EN_PREPARATION',
  'SOUMISE',
  'VERIFIEE_MEDECIN_CONSEIL',
  'PROGRAMMEE_PAIEMENT',
  'PAYEE',
] as const;
export type StatutFactureMensuelleEtablissement =
  (typeof STATUTS_FACTURE_MENSUELLE_ETABLISSEMENT)[number];

/**
 * Vérification de fin de mois, GLOBALE et INDÉPENDANTE des validations
 * individuelles déjà faites pendant le mois par l'exploitation (pré-
 * autorisation acte par acte) — réservée EXCLUSIVEMENT à ASSUREUR_MEDECIN_CONSEIL.
 */
export const ROLE_VERIFICATION_FACTURE_MENSUELLE_ETABLISSEMENT = 'ASSUREUR_MEDECIN_CONSEIL';
export const ROLE_COMPTABLE_FACTURE_MENSUELLE_ETABLISSEMENT = 'ASSUREUR_COMPTABLE';

export const DECISIONS_VERIFICATION_FACTURE_MENSUELLE_ETABLISSEMENT = [
  'VALIDEE',
  'A_CORRIGER',
] as const;
export type DecisionVerificationFactureMensuelleEtablissement =
  (typeof DECISIONS_VERIFICATION_FACTURE_MENSUELLE_ETABLISSEMENT)[number];

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
