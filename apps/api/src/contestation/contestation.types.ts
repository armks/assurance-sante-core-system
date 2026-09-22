/**
 * Types du module `contestation/` — accès en revue du pharmacien conseil sur
 * les prescriptions, et mécanisme de contestation d'une ligne d'ordonnance
 * déjà servie (prévu depuis le plan directeur, jamais construit jusqu'ici).
 */

export const STATUTS_CONTESTATION = [
  'OUVERT',
  'JUSTIFICATION_RECUE',
  'VALIDEE',
  'REJETEE',
] as const;
export type StatutContestation = (typeof STATUTS_CONTESTATION)[number];

/**
 * Tant qu'une contestation est dans l'un de ces statuts, la ligne d'ordonnance
 * concernée est exclue de tout calcul de montant facturable (`PharmacyService`
 * renvoie `enLitige: true` à la place d'un montant). OUVERT/JUSTIFICATION_RECUE
 * = exclusion temporaire (en cours d'instruction) ; REJETEE = exclusion
 * définitive. Seul VALIDEE débloque la ligne pour facturation normale.
 */
export const STATUTS_CONTESTATION_EN_LITIGE = [
  'OUVERT',
  'JUSTIFICATION_RECUE',
  'REJETEE',
] as const;

/** Ouverture et tranchage d'une contestation — réservés EXCLUSIVEMENT à ce rôle. */
export const ROLE_PHARMACIEN_CONSEIL = 'ASSUREUR_PHARMACIEN_CONSEIL';

/** Soumission de la justification — réservée à la pharmacie CONCERNÉE
 * (`ligneOrdonnance.pharmacieServanteId`), jamais PHARMACIE_CAISSIERE
 * (clarification métier déjà appliquée ailleurs : la caissière prépare, elle
 * ne répond pas d'un litige financier). */
export const ROLES_JUSTIFICATION_PHARMACIE = [
  'PHARMACIE_PHARMACIEN',
  'PHARMACIE_COMPTABLE',
] as const;

/** Bucket de stockage privé des pièces justificatives (prisma/sql/043). */
export const BUCKET_PIECES_JUSTIFICATIVES = 'contestations';
export const TAILLE_MAX_PIECE_OCTETS = 10 * 1024 * 1024;
export const MIME_TYPES_PIECES_AUTORISES = ['application/pdf', 'image/jpeg', 'image/png'];

export interface ContexteAppelant {
  userId: string;
  organisationId: string;
  roleChain: string[];
  pharmacieId: string | null;
}
