/**
 * Constantes du fichier des membres — MIROIR de `apps/api/src/member/member.types.ts`.
 * Sert au retrait visuel des actions non autorisées ; l'API reste seule juge.
 */

export const STATUTS_MEMBRE = ['ACTIF', 'SUSPENDU', 'RADIE'] as const;

export const LIBELLE_STATUT_MEMBRE: Record<string, string> = {
  ACTIF: 'Actif',
  SUSPENDU: 'Suspendu',
  RADIE: 'Radié',
};

export const TON_STATUT_MEMBRE: Record<
  string,
  'succes' | 'attention' | 'danger'
> = {
  ACTIF: 'succes',
  SUSPENDU: 'attention',
  RADIE: 'danger',
};

export const SEXES = [
  { valeur: 'M', libelle: 'Masculin' },
  { valeur: 'F', libelle: 'Féminin' },
];

export const LIENS_PARENTE = [
  { valeur: 'CONJOINT', libelle: 'Conjoint' },
  { valeur: 'ENFANT', libelle: 'Enfant' },
  { valeur: 'PERE', libelle: 'Père' },
  { valeur: 'MERE', libelle: 'Mère' },
  { valeur: 'AUTRE', libelle: 'Autre' },
];

export const MODES_PAIEMENT = [
  { valeur: 'MOBILE_MONEY', libelle: 'Mobile Money' },
  { valeur: 'VIREMENT_BANCAIRE', libelle: 'Virement bancaire' },
];

export const ROLES_GESTION_MEMBRE = [
  'ASSUREUR_DIRECTION',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_INFORMATIQUE',
];
export const ROLE_GESTION_MEMBRE_SOCIETE = 'SOCIETE_ADMINISTRATION';

export function peutGererMembres(roleChain: string[] | undefined): boolean {
  const rc = roleChain ?? [];
  return (
    rc.some((r) => ROLES_GESTION_MEMBRE.includes(r)) ||
    rc.includes(ROLE_GESTION_MEMBRE_SOCIETE)
  );
}
