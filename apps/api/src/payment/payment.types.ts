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

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  roleChain: string[];
}
