export const ROLE_SUPERADMIN = 'SUPERADMIN_PRINCIPAL';

/**
 * Qui met à jour le CATALOGUE NATIONAL (actes, médicaments : création, modification, homologation, retrait, suppression, import Excel) :
 * le superadmin ET l'assurance informatique (ADR-009). Le catalogue étant partagé, chaque écriture est tracée (`log_audit`, avec l'organisation
 * de l'auteur). Les paramètres de la plateforme, la santé du système et les lettres-clés restent au seul superadmin.
 */
export const ROLES_GESTION_CATALOGUE_NATIONAL = [ROLE_SUPERADMIN, 'ASSUREUR_INFORMATIQUE'] as const;

export const ACTIONS_SUPERADMIN = [
  'CREATION_ORGANISATION',
  'SUSPENSION_ORGANISATION',
  'PROLONGATION_ORGANISATION',
] as const;
export type ActionSuperadmin = (typeof ACTIONS_SUPERADMIN)[number];

export const PLANS_LICENCE = ['STARTER', 'BUSINESS', 'ENTERPRISE'] as const;

/** Limites par défaut par plan (adhérents / appels API mensuels). */
export const LIMITES_PAR_PLAN: Record<
  string,
  { limiteAdherents: number; limiteAppelsApiMois: number }
> = {
  STARTER: { limiteAdherents: 500, limiteAppelsApiMois: 50_000 },
  BUSINESS: { limiteAdherents: 5_000, limiteAppelsApiMois: 500_000 },
  ENTERPRISE: { limiteAdherents: 100_000, limiteAppelsApiMois: 10_000_000 },
};

/** Alphabet du code de validation — sans caractères ambigus. */
export const ALPHABET_CODE_SA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LONGUEUR_CODE_SA = 8;

/** Libellés lisibles pour l'e-mail de confirmation. */
export const LIBELLE_ACTION: Record<string, string> = {
  CREATION_ORGANISATION: "Création d'une organisation",
  SUSPENSION_ORGANISATION: "Suspension d'une organisation",
  PROLONGATION_ORGANISATION: "Prolongation de la licence d'une organisation",
};

/** Actions de masse sur le catalogue national : plafond d'éléments par requête (chacun est contrôlé individuellement). */
export const MAX_ELEMENTS_ACTION_MASSE = 100;
export const ACTIONS_MASSE_CATALOGUE = ['archiver', 'desarchiver', 'supprimer', 'homologuer'] as const;
export type ActionMasseCatalogue = (typeof ACTIONS_MASSE_CATALOGUE)[number];
export type TypeCatalogue = 'actes' | 'medicaments';

/** Résultat par élément d'une action de masse. */
export interface ResultatElementMasse {
  id: string;
  nom: string;
  ok: boolean;
  /** Raison en français quand l'élément est refusé. */
  raison: string | null;
}
export interface ResultatActionMasse {
  type: TypeCatalogue;
  action: ActionMasseCatalogue;
  demandes: number;
  reussis: number;
  refuses: number;
  resultats: ResultatElementMasse[];
}
