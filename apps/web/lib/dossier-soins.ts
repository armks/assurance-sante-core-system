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
