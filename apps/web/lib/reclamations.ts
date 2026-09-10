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
  E001: 'Police non active à la date des soins (suspendue, résiliée ou hors période)',
  E006: 'Plafond annuel de la garantie atteint ou dépassé pour cet adhérent',
  E010: "Montant remboursé au-dessus du seuil d'adjudication automatique",
  ADJ_ECHEC:
    "Échec temporaire de l'appel au microservice d'adjudication — à re-soumettre",
  REJET_MANUEL: 'Rejet prononcé après revue manuelle',
};

export function libelleCodeRejet(code: string): string {
  return LIBELLE_CODE_REJET[code] ?? `Code ${code}`;
}

const TYPES_RECLAMATION_MEDICAUX = [
  'SOIN',
  'PHARMACIE',
  'HOSPITALISATION',
  'OPTIQUE',
  'DENTAIRE',
  'ANALYSES',
  'IMAGERIE',
];

export const ROLE_REVUE_MEDICALE = 'ASSUREUR_MEDECIN_CONSEIL';
export const ROLE_REVUE_FINANCIERE = 'ASSUREUR_EXPLOITATION';
export const ROLE_REVUE_SUPERVISION = 'ASSUREUR_DIRECTION';

/** Rôle requis pour traiter la revue manuelle d'une réclamation de ce type. */
export function roleRevuePour(typeReclamation: string): string {
  return TYPES_RECLAMATION_MEDICAUX.includes(typeReclamation)
    ? ROLE_REVUE_MEDICALE
    : ROLE_REVUE_FINANCIERE;
}

/** L'utilisateur (roleChain) peut-il traiter la revue manuelle de cette réclamation ? */
export function peutTraiterRevue(
  roleChain: string[] | undefined,
  typeReclamation: string,
): boolean {
  const rc = roleChain ?? [];
  return (
    rc.includes(roleRevuePour(typeReclamation)) ||
    rc.includes(ROLE_REVUE_SUPERVISION)
  );
}
