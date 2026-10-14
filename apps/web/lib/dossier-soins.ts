import type { FiltreSelect } from '@/components/dashboard/patterns';

/**
 * Libellés des statuts du parcours de soins — SOURCE UNIQUE pour les badges et
 * les filtres de tous les écrans (centre médical, supervision assureur, revue
 * médicale, réclamations). MIROIR des listes de `apps/api/src/care-episode`.
 * Ne jamais laisser `StatutBadge` dériver le libellé de ces jetons : son
 * libellé automatique perd les accents (« Transfere », « Cloture »).
 */
export const LIBELLE_STATUT_DOSSIER: Record<string, string> = {
  OUVERT: 'Ouvert',
  SUSPENDU: 'Suspendu',
  TRANSFERE: 'Transféré',
  CLOTURE: 'Clôturé',
  FORCE_CLOS: 'Clôturé (forcé)',
};

/** Filtre « Statut » des listes de dossiers, dérivé de `LIBELLE_STATUT_DOSSIER`. */
export const FILTRE_STATUT_DOSSIER: FiltreSelect = {
  cle: 'statut',
  libelle: 'Statut',
  options: Object.entries(LIBELLE_STATUT_DOSSIER).map(([valeur, libelle]) => ({
    valeur,
    libelle,
  })),
};

export const LIBELLE_STATUT_CONSULTATION: Record<string, string> = {
  EN_COURS: 'En cours',
  TERMINEE: 'Terminée',
  ANNULEE: 'Annulée',
};

export const LIBELLE_STATUT_TICKET: Record<string, string> = {
  OUVERT: 'Ouvert',
  CLOTURE: 'Clôturé',
  ANNULE: 'Annulé',
};

/** Cycles de facturation d'un dossier, vus par l'ÉTABLISSEMENT (l'adhérent a
 * ses propres formulations, cf. `adherent/factures-ecran.tsx`). */
export const LIBELLE_STATUT_FACTURE_DOSSIER: Record<string, string> = {
  EMISE: 'Émise — en attente du patient',
  EN_VALIDATION: 'En validation',
  VALIDEE: 'Validée par le patient',
  REGLEE: 'Réglée',
  CONTESTEE: 'Contestée',
};

export const TON_STATUT_FACTURE_DOSSIER: Record<
  string,
  'succes' | 'attention' | 'danger' | 'neutre'
> = {
  EMISE: 'attention',
  EN_VALIDATION: 'attention',
  VALIDEE: 'attention',
  REGLEE: 'succes',
  CONTESTEE: 'danger',
};

/**
 * Acte du référentiel qui sert à FACTURER la consultation selon le type de visite du dossier : son tarif est celui de la convention
 * de l'établissement (calculé par le microservice d'adjudication via `GET /preauthorization/actes/tarif-reference`).
 * Un type de visite absent de cette table n'a pas de coût de consultation affiché.
 */
export const ACTE_CONSULTATION_PAR_TYPE_VISITE: Record<string, { codeActe: string; categorieActe: string }> = {
  CONSULTATION_GENERALISTE: { codeActe: 'MAGC001', categorieActe: 'CONSULTATION' },
  CONSULTATION_SPECIALISTE: { codeActe: 'MAGC002', categorieActe: 'CONSULTATION' },
};

export const LIBELLE_STATUT_ORDONNANCE: Record<string, string> = {
  ACTIVE: 'Active',
  PARTIELLEMENT_DELIVREE: 'Partiellement délivrée',
  COMPLETEMENT_DELIVREE: 'Délivrée',
  EXPIREE: 'Expirée',
  ANNULEE: 'Annulée',
};
