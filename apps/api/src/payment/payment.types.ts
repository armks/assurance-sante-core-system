/**
 * Types du module `payment/` — regroupement de plusieurs factures mensuelles
 * (établissement OU pharmacie, jamais mélangées) déjà VALIDÉES POUR PAIEMENT
 * (`validerPourPaiement(Etablissement)`, modules `preauthorization`/`pharmacy`)
 * en un paiement programmé unique. Lit/écrit `factures_mensuelles_etablissement`/
 * `factures_mensuelles_pharmacie` directement via Prisma — même convention que
 * `contestation/` lisant `pharmacy`/`preauthorization` (un module = un domaine,
 * mais la lecture croisée via Prisma reste la norme établie dans ce projet).
 */

export const ROLE_COMPTABLE_PAIEMENT_GROUPE = 'ASSUREUR_COMPTABLE';

export const BENEFICIAIRE_TYPES_PAIEMENT_GROUPE = ['ETABLISSEMENT', 'PHARMACIE'] as const;
export type BeneficiaireTypePaiementGroupe = (typeof BENEFICIAIRE_TYPES_PAIEMENT_GROUPE)[number];

export const STATUTS_PAIEMENT_GROUPE = ['PROGRAMME', 'PAYE'] as const;
export type StatutPaiementGroupe = (typeof STATUTS_PAIEMENT_GROUPE)[number];

/** Statuts des factures individuelles éligibles à un regroupement. */
export const STATUT_FACTURE_MENSUELLE_GROUPABLE = 'PROGRAMMEE_PAIEMENT';

/** Catégorie d'acte conventionnelle pour une ligne pharmacie dans le tableau
 * global comptable (item 5) — pas de `categorieActe` réel côté pharmacie,
 * dupliqué depuis `pharmacy.types.ts` (CATEGORIE_ACTE_PHARMACIE). */
export const CATEGORIE_ACTE_PHARMACIE = 'PHARMACIE';

// --- Comptes financiers de l'assureur (trésorerie interne) ---------------

export const TYPES_COMPTE_FINANCIER = ['BANCAIRE', 'CAISSE_INTERNE'] as const;
export type TypeCompteFinancier = (typeof TYPES_COMPTE_FINANCIER)[number];

export const SOURCES_APPROVISIONNEMENT = ['EXTERNE', 'AUTRE_COMPTE'] as const;
export type SourceApprovisionnement = (typeof SOURCES_APPROVISIONNEMENT)[number];

/**
 * Gestion des comptes financiers — réservée EXCLUSIVEMENT au rôle EXACT
 * ASSUREUR_COMPTABLE, jamais ASSUREUR_COMPTABLE_ADJOINT. Vérifiée sur
 * `ctx.role` (valeur PROPRE au profil, telle qu'assignée), JAMAIS sur
 * `ctx.roleChain` ni via `profil_a_role` (tous deux remontent l'adjoint vers
 * son parent — `role_parent_code`, comportement délibérément exploité
 * ailleurs pour les factures mensuelles/paiements groupés, mais explicitement
 * exclu ici) — et jamais via `permissions.peutValider` (reflète une capacité
 * générique propre au rôle, indépendante de ce périmètre précis : deux
 * rôles totalement étrangers à la comptabilité financière peuvent très bien
 * partager `peutValider = true`/`false` sans rapport avec cette autorisation).
 */
export const ROLES_GESTION_COMPTES_FINANCIERS = ['ASSUREUR_COMPTABLE'] as const;

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  /** Rôle PROPRE du profil (`profils.role`), sans résolution d'héritage —
   * seul champ fiable pour distinguer ASSUREUR_COMPTABLE de son adjoint. */
  role: string | null;
  roleChain: string[];
}
