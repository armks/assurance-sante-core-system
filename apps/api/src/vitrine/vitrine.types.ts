import type { ReglesLimite } from './limiteur-requetes';

/** Formulaires de la page d'accueil publique. */
export const TYPES_DEMANDE = ['CONTACT', 'PARTENAIRE', 'ADHESION'] as const;
export type TypeDemande = (typeof TYPES_DEMANDE)[number];

export const CATEGORIES_PARTENAIRE = ['ETABLISSEMENT', 'PHARMACIE'] as const;

export const LIBELLE_TYPE_DEMANDE: Record<TypeDemande, string> = {
  CONTACT: 'Demande de contact',
  PARTENAIRE: 'Candidature partenaire',
  ADHESION: 'Demande d’adhésion',
};

export const LIBELLE_CATEGORIE: Record<(typeof CATEGORIES_PARTENAIRE)[number], string> = {
  ETABLISSEMENT: 'Établissement de santé',
  PHARMACIE: 'Pharmacie',
};

/**
 * Débits autorisés (fenêtre glissante de 15 min). Les demandes envoient un
 * e-mail : plafond global serré pour borner le volume Resend quoi qu'il
 * arrive. La newsletter n'écrit qu'en base : un peu plus souple.
 */
export const LIMITE_DEMANDES: ReglesLimite = { parCle: 3, global: 30, fenetreMs: 15 * 60 * 1000 };
export const LIMITE_NEWSLETTER: ReglesLimite = { parCle: 5, global: 100, fenetreMs: 15 * 60 * 1000 };
/** Statistiques : simple lecture en cache, un chargement de page = une requête. */
export const LIMITE_STATISTIQUES: ReglesLimite = { parCle: 60, global: 3000, fenetreMs: 15 * 60 * 1000 };
/** Événements publics : même profil que les statistiques (une requête par chargement de page). */
export const LIMITE_EVENEMENTS: ReglesLimite = { parCle: 60, global: 3000, fenetreMs: 15 * 60 * 1000 };
