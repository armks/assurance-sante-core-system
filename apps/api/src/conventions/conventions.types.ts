/** Saisie d'une convention : assurance informatique (et son adjoint, par héritage de rôle). */
export const ROLES_SAISIE_CONVENTION = ['ASSUREUR_INFORMATIQUE'] as const;

/**
 * Validation / refus : médecin conseil, direction ou assurance informatique. La séparation saisie / validation reste imposée aux
 * médecin conseil et direction ; l'assurance informatique, qui saisit les conventions, peut aussi valider les siennes.
 */
export const ROLES_VALIDATION_CONVENTION = ['ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE'] as const;

/** Lecture : les trois rôles ci-dessus (même organisation uniquement). */
export const ROLES_LECTURE_CONVENTION = [
  'ASSUREUR_INFORMATIQUE',
  'ASSUREUR_MEDECIN_CONSEIL',
  'ASSUREUR_DIRECTION',
] as const;

export const STATUTS_CONVENTION = ['PROPOSEE', 'VALIDEE', 'REFUSEE', 'ARCHIVEE'] as const;
export type StatutConvention = (typeof STATUTS_CONVENTION)[number];

export const CONTEXTES_CONVENTION = ['AMBULATOIRE', 'HOSPITALISATION'] as const;
export const POLITIQUES_DEPASSEMENT = ['PATIENT', 'REJET'] as const;

/** Document signé : PDF ou image, 10 Mo au plus (bucket privé `conventions`, prisma/sql/081). */
export const TAILLE_MAX_DOCUMENT_OCTETS = 10 * 1024 * 1024;
export const TYPES_DOCUMENT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export const VALEUR_MAX = 99_999_999.99;
