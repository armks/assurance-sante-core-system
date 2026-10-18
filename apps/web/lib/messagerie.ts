/**
 * Messagerie interne : rôles qui voient la bulle de discussion (le serveur applique les vraies règles — qui peut écrire à qui —
 * à chaque message ; cette liste ne sert qu'à ne pas afficher la messagerie aux profils qui n'y ont pas accès).
 */
export const ROLES_MESSAGERIE: readonly string[] = [
  'ASSUREUR_INFORMATIQUE',
  'ASSUREUR_INFORMATIQUE_ADJOINT',
  'ASSUREUR_EXPLOITATION',
  'ASSUREUR_EXPLOITATION_CONJOINTE',
  'ASSUREUR_MEDECIN_CONSEIL',
  'ASSUREUR_PHARMACIEN_CONSEIL',
  'ASSUREUR_COMPTABLE',
  'ASSUREUR_SECRETAIRE',
  'CENTRE_MEDICAL_MEDECIN',
  'CENTRE_MEDICAL_ACCUEIL',
  'CENTRE_MEDICAL_ADMINISTRATIF',
  'CENTRE_MEDICAL_COMPTABLE',
  'PHARMACIE_PHARMACIEN',
  'PHARMACIE_CAISSIERE',
  'PHARMACIE_COMPTABLE',
  'ADHERENT_TITULAIRE',
  'SOUSCRIPTEUR_INDIVIDUEL',
];

export interface ContactMessagerie {
  id: string;
  nom: string;
  role: string;
  libelleRole: string | null;
  lieu: string | null;
  enLigne: boolean;
  conversationId?: string | null;
  statutConversation?: string | null;
}

export interface ConversationMessagerie {
  id: string;
  statut: 'INVITATION' | 'ACTIVE' | 'REFUSEE';
  initieParMoi: boolean;
  interlocuteur: ContactMessagerie;
  dernierMessage: { apercu: string; date: string; deMoi: boolean } | null;
  nonLus: number;
  derniereActivite: string;
}

export interface MessageMessagerie {
  id: string;
  conversationId: string;
  expediteurId: string;
  contenu: string | null;
  fichier: { nom: string; type: string | null; taille: number | null } | null;
  createdAt: string;
  luLe: string | null;
}

export const TAILLE_MAX_FICHIER = 5 * 1024 * 1024;
export const LONGUEUR_MAX_MESSAGE = 2000;
