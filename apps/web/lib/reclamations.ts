/**
 * Constantes des réclamations côté assureur — MIROIR de `claims.types.ts`.
 * Sert au retrait visuel des actions non autorisées ; l'API reste seule juge.
 */

export const STATUTS_RECLAMATION = [
  'SOUMISE',
  'EN_ADJUDICATION',
  'AUTO_ADJUDIQUE',
  'REVUE_MANUELLE',
  'REJETE',
  'PAYEE',
] as const;

export const LIBELLE_STATUT_RECLAMATION: Record<string, string> = {
  SOUMISE: 'Soumise',
  EN_ADJUDICATION: 'En adjudication',
  AUTO_ADJUDIQUE: 'Auto-adjudiquée',
  REVUE_MANUELLE: 'Revue manuelle',
  REJETE: 'Rejetée',
  PAYEE: 'Payée',
};

/** Tonalité forcée par jeton (StatutBadge `map`). */
export const TON_STATUT_RECLAMATION: Record<
  string,
  'succes' | 'attention' | 'danger' | 'info' | 'neutre'
> = {
  SOUMISE: 'attention',
  EN_ADJUDICATION: 'info',
  AUTO_ADJUDIQUE: 'succes',
  REVUE_MANUELLE: 'attention',
  REJETE: 'danger',
  PAYEE: 'succes',
};

export const LIBELLE_CODE_REJET: Record<string, string> = {
  E001: 'La police ne couvrait pas la date des soins (suspendue, pas encore en vigueur, ou soins après sa fin)',
  E006: 'Plafond annuel de la garantie atteint ou dépassé pour cet adhérent',
  E010: "Montant remboursé au-dessus du seuil d'adjudication automatique",
  E011: "Catégorie d'acte non couverte par le produit (aucune garantie)",
  E012: 'Soins antérieurs à la date de début de la police',
  E013: 'Date des soins postérieure à la date de déclaration (soins dans le futur)',
  E014: 'Soins déclarés après le délai suivant la fin de la police',
  ADJ_ECHEC:
    "Échec temporaire de l'appel au microservice d'adjudication — à re-soumettre",
  REJET_MANUEL: 'Rejet prononcé après revue manuelle',
};

export function libelleCodeRejet(code: string): string {
  return LIBELLE_CODE_REJET[code] ?? `Code ${code}`;
}

export const ROLE_REVUE_MEDICALE = 'ASSUREUR_MEDECIN_CONSEIL';
export const ROLE_REVUE_FINANCIERE = 'ASSUREUR_EXPLOITATION';
export const ROLE_REVUE_SUPERVISION = 'ASSUREUR_DIRECTION';

/**
 * L'utilisateur (roleChain) peut-il traiter la revue manuelle de cette
 * réclamation ? `roleRevue` est fourni par l'API (référentiel
 * `categories_acte.role_revue`, prisma/sql/067) — le web ne redéfinit plus la
 * règle catégorie/type → rôle.
 */
export function peutTraiterRevue(
  roleChain: string[] | undefined,
  roleRevue: string,
): boolean {
  const rc = roleChain ?? [];
  return rc.includes(roleRevue) || rc.includes(ROLE_REVUE_SUPERVISION);
}
