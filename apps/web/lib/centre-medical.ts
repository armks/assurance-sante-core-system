/**
 * Constantes du parcours de soins côté établissement — MIROIR des règles
 * d'autorisation du backend (`apps/api/src/care-episode` /
 * `apps/api/src/preauthorization`). Sert uniquement au **retrait visuel** des
 * actions qu'un rôle ne peut pas exécuter : l'API reste seule juge (elle renvoie
 * un 403 si on force). Ne jamais dupliquer ici une machine à états — seulement
 * des ensembles de rôles.
 */

export const ROUTE_CENTRE_MEDICAL = '/dashboard-centre-medical';

/** care-episode : `ROLES_GESTION_DOSSIER` (valider un code, consultation, clôture). */
export const ROLES_GESTION_DOSSIER = [
  'CENTRE_MEDICAL_ACCUEIL',
  'CENTRE_MEDICAL_MEDECIN',
  'CENTRE_MEDICAL_ADMINISTRATIF',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_INFORMATIQUE',
];

/** preauthorization : `ROLES_AJOUT_ACTE`. */
export const ROLES_AJOUT_ACTE = [
  'CENTRE_MEDICAL_MEDECIN',
  'CENTRE_MEDICAL_ACCUEIL',
  'CENTRE_MEDICAL_ADMINISTRATIF',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_INFORMATIQUE',
];

/** preauthorization : rôles pouvant émettre une ordonnance (hors le médecin lui-même). */
export const ROLES_ORDONNANCE_DELEGUEE = [
  'CENTRE_MEDICAL_ADMINISTRATIF',
  'CENTRE_MEDICAL_ACCUEIL',
];

/** preauthorization : `ROLES_GENERATION_FACTURE` (générer la facture d'un ticket clôturé). */
export const ROLES_GENERATION_FACTURE = [
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_COMPTABLE',
  'ASSUREUR_INFORMATIQUE',
  'CENTRE_MEDICAL_COMPTABLE',
  'CENTRE_MEDICAL_ADMINISTRATIF',
  // l'accueil facture les actes que le médecin l'a informé avoir effectués
  'CENTRE_MEDICAL_ACCUEIL',
];

/** preauthorization : `ROLE_DECLARATION_REALISATION` — l'accueil déclare la réalisation d'un acte « sur information du médecin ». */
export const ROLE_DECLARATION_REALISATION = 'CENTRE_MEDICAL_ACCUEIL';

export const ROLE_MEDECIN_TRAITANT = 'CENTRE_MEDICAL_MEDECIN';

export function aUnRole(roleChain: string[] | undefined, roles: string[]): boolean {
  return (roleChain ?? []).some((r) => roles.includes(r));
}

/** member : `ROLE_RECHERCHE_CARTE` — réservé exclusivement à l'accueil du centre médical. */
export const ROLE_RECHERCHE_CARTE = 'CENTRE_MEDICAL_ACCUEIL';

/**
 * preauthorization : pré-autorisation obligatoire pour les actes
 * ANALYSES_EXAMENS_MEDICAUX — déclenchée côté serveur (jamais par le client)
 * à l'ajout d'un acte quand `dossier.typeVisite = ANALYSES_EXAMENS_MEDICAUX`.
 * Tant qu'EN_ATTENTE_VALIDATION ou REFUSEE, l'acte est exclu de toute
 * facturation.
 */
export const LIBELLE_PREAUTORISATION: Record<string, string> = {
  NON_REQUISE: 'Non requise',
  EN_ATTENTE_EXPLOITATION: 'En attente (exploitation)',
  EN_ATTENTE_MEDECIN_CONSEIL: 'En attente (médecin conseil)',
  APPROUVEE: 'Approuvée',
  APPROUVEE_PARTIELLEMENT: 'Approuvée partiellement',
  REFUSEE: 'Refusée',
};
/**
 * Statut d'un acte (`actes_dossier.statut`). Seul un acte RÉALISÉ (attesté par
 * le médecin traitant) est facturable — PRESCRIT est donc signalé en ambre.
 */
export const LIBELLE_STATUT_ACTE: Record<string, string> = {
  PRESCRIT: 'Prescrit — non réalisé',
  REALISE: 'Réalisé',
  ANNULE: 'Annulé',
  LIQUIDE: 'Liquidé',
};
export const TON_STATUT_ACTE: Record<
  string,
  'succes' | 'attention' | 'danger' | 'neutre'
> = {
  PRESCRIT: 'attention',
  REALISE: 'succes',
  ANNULE: 'danger',
  LIQUIDE: 'neutre',
};
export const STATUTS_ACTE_FACTURABLES = ['REALISE', 'LIQUIDE'];

export const TON_PREAUTORISATION: Record<
  string,
  'succes' | 'attention' | 'danger' | 'neutre'
> = {
  NON_REQUISE: 'neutre',
  EN_ATTENTE_EXPLOITATION: 'attention',
  EN_ATTENTE_MEDECIN_CONSEIL: 'attention',
  APPROUVEE: 'succes',
  APPROUVEE_PARTIELLEMENT: 'succes',
  REFUSEE: 'danger',
};

/**
 * care-episode : `TYPES_VISITE` — choisi UNE FOIS, à l'intérieur du dossier,
 * après son ouverture (jamais avant : l'ouverture reste conditionnée au seul
 * code de consultation).
 */
export const TYPES_VISITE = [
  { valeur: 'CONSULTATION_GENERALISTE', libelle: 'Consultation généraliste' },
  { valeur: 'CONSULTATION_SPECIALISTE', libelle: 'Consultation spécialiste' },
  { valeur: 'HOSPITALISATION_MEDICALE', libelle: 'Hospitalisation médicale' },
  { valeur: 'ANALYSES_EXAMENS_MEDICAUX', libelle: 'Analyses / examens médicaux' },
  { valeur: 'ACTES_DENTAIRES', libelle: 'Actes dentaires' },
  { valeur: 'CONSULTATION_DENTAIRE', libelle: 'Consultation dentaire' },
  { valeur: 'PRESCRIPTION_MEDICALE', libelle: 'Prescription médicale' },
];
