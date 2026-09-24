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

/** Validation d'un adhérent principal — réservée à ASSUREUR_EXPLOITATION
 * exclusivement (gouverne la coupure de facturation mensuelle), distinct de
 * `peutGererMembres` (création/statut, ouvert à DIRECTION/INFORMATIQUE aussi). */
export function peutValiderAdherent(roleChain: string[] | undefined): boolean {
  return (roleChain ?? []).includes('ASSUREUR_EXPLOITATION');
}

/** Import Excel en masse — réservé à ASSUREUR_INFORMATIQUE et ASSUREUR_COMPTABLE. */
export function peutImporterAdherents(roleChain: string[] | undefined): boolean {
  const rc = roleChain ?? [];
  return rc.includes('ASSUREUR_INFORMATIQUE') || rc.includes('ASSUREUR_COMPTABLE');
}

/** Validation d'un import Excel — réservée à ASSUREUR_INFORMATIQUE et
 * ASSUREUR_EXPLOITATION (jamais ASSUREUR_COMPTABLE, qui peut pourtant importer). */
export function peutValiderImportAdherents(roleChain: string[] | undefined): boolean {
  const rc = roleChain ?? [];
  return rc.includes('ASSUREUR_INFORMATIQUE') || rc.includes('ASSUREUR_EXPLOITATION');
}

/** Propositions collaboratives d'ajout d'adhérents/bénéficiaires par une
 * société cliente (brouillon → soumission) — élargi par rapport à
 * `peutGererMembres` côté société : SOCIETE_ASSUREE peut PROPOSER (encore
 * soumis à validation assureur) sans pouvoir créer directement. */
export const ROLES_PROPOSITION_MEMBRE_SOCIETE = ['SOCIETE_ASSUREE', 'SOCIETE_ADMINISTRATION'];

export function peutProposerMembres(roleChain: string[] | undefined): boolean {
  const rc = roleChain ?? [];
  return rc.some((r) => ROLES_PROPOSITION_MEMBRE_SOCIETE.includes(r));
}

/**
 * Double validation d'un bénéficiaire proposé par l'ADHÉRENT lui-même
 * (distinct des propositions société ci-dessus) : EN_ATTENTE_SOCIETE →
 * EN_ATTENTE_ASSUREUR → ACTIF (numéro de carte attribué à ce moment précis).
 */
export const STATUT_BENEFICIAIRE_EN_ATTENTE_SOCIETE = 'EN_ATTENTE_SOCIETE';
export const STATUT_BENEFICIAIRE_EN_ATTENTE_ASSUREUR = 'EN_ATTENTE_ASSUREUR';

export const LIBELLE_STATUT_BENEFICIAIRE: Record<string, string> = {
  ...LIBELLE_STATUT_MEMBRE,
  EN_ATTENTE_SOCIETE: 'En attente (société)',
  EN_ATTENTE_ASSUREUR: 'En attente (assureur)',
};

export const TON_STATUT_BENEFICIAIRE: Record<
  string,
  'succes' | 'attention' | 'danger'
> = {
  ...TON_STATUT_MEMBRE,
  EN_ATTENTE_SOCIETE: 'attention',
  EN_ATTENTE_ASSUREUR: 'attention',
};

export function peutValiderBeneficiaireSociete(roleChain: string[] | undefined): boolean {
  return (roleChain ?? []).includes('SOCIETE_ADMINISTRATION');
}

export function peutValiderBeneficiaireAssureur(roleChain: string[] | undefined): boolean {
  const rc = roleChain ?? [];
  return rc.includes('ASSUREUR_INFORMATIQUE') || rc.includes('ASSUREUR_EXPLOITATION');
}
