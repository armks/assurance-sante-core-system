/**
 * Règles de la messagerie interne : qui peut écrire à qui. Une seule table, appliquée côté serveur à chaque message ;
 * l'interface ne fait que masquer ce que le serveur refuserait.
 */
export type GroupeMessagerie =
  | 'INFORMATIQUE'
  | 'EXPLOITATION'
  | 'MEDECIN_CONSEIL'
  | 'PHARMACIEN_CONSEIL'
  | 'COMPTABLE_ASSURANCE'
  | 'COMPTABLE_ETABLISSEMENT'
  | 'COMPTABLE_PHARMACIE'
  | 'ETABLISSEMENT'
  | 'PHARMACIE'
  | 'ADHERENT';

/** Rôle → groupe. Les rôles absents (direction, superadmin, sociétés assurées, comptable adjoint…) n'ont pas accès à la messagerie. */
export const GROUPE_PAR_ROLE: Readonly<Record<string, GroupeMessagerie>> = {
  ASSUREUR_INFORMATIQUE: 'INFORMATIQUE',
  ASSUREUR_INFORMATIQUE_ADJOINT: 'INFORMATIQUE',
  ASSUREUR_EXPLOITATION: 'EXPLOITATION',
  ASSUREUR_EXPLOITATION_CONJOINTE: 'EXPLOITATION',
  ASSUREUR_MEDECIN_CONSEIL: 'MEDECIN_CONSEIL',
  ASSUREUR_PHARMACIEN_CONSEIL: 'PHARMACIEN_CONSEIL',
  ASSUREUR_COMPTABLE: 'COMPTABLE_ASSURANCE',
  CENTRE_MEDICAL_COMPTABLE: 'COMPTABLE_ETABLISSEMENT',
  PHARMACIE_COMPTABLE: 'COMPTABLE_PHARMACIE',
  CENTRE_MEDICAL_MEDECIN: 'ETABLISSEMENT',
  CENTRE_MEDICAL_ACCUEIL: 'ETABLISSEMENT',
  CENTRE_MEDICAL_ADMINISTRATIF: 'ETABLISSEMENT',
  PHARMACIE_PHARMACIEN: 'PHARMACIE',
  PHARMACIE_CAISSIERE: 'PHARMACIE',
  ADHERENT_TITULAIRE: 'ADHERENT',
  SOUSCRIPTEUR_INDIVIDUEL: 'ADHERENT',
};

/**
 * Paires de groupes autorisées (symétriques). Le comptable d'établissement et celui de la pharmacie sont des groupes à part : ils
 * parlent aussi au comptable de l'assurance, contrairement aux autres membres de leur structure.
 * Informatique et exploitation (assurance) parlent à tous les profils de la messagerie, et entre eux.
 */
const PAIRES: ReadonlyArray<readonly [GroupeMessagerie, GroupeMessagerie]> = [
  ['ETABLISSEMENT', 'EXPLOITATION'],
  ['ETABLISSEMENT', 'INFORMATIQUE'],
  ['COMPTABLE_ETABLISSEMENT', 'EXPLOITATION'],
  ['COMPTABLE_ETABLISSEMENT', 'INFORMATIQUE'],
  ['COMPTABLE_ETABLISSEMENT', 'COMPTABLE_ASSURANCE'],
  ['PHARMACIE', 'INFORMATIQUE'],
  ['PHARMACIE', 'EXPLOITATION'],
  ['COMPTABLE_PHARMACIE', 'INFORMATIQUE'],
  ['COMPTABLE_PHARMACIE', 'EXPLOITATION'],
  ['COMPTABLE_PHARMACIE', 'COMPTABLE_ASSURANCE'],
  ['MEDECIN_CONSEIL', 'EXPLOITATION'],
  ['MEDECIN_CONSEIL', 'PHARMACIEN_CONSEIL'],
  ['MEDECIN_CONSEIL', 'INFORMATIQUE'],
  ['PHARMACIEN_CONSEIL', 'EXPLOITATION'],
  ['PHARMACIEN_CONSEIL', 'INFORMATIQUE'],
  ['COMPTABLE_ASSURANCE', 'EXPLOITATION'],
  ['COMPTABLE_ASSURANCE', 'INFORMATIQUE'],
  ['ADHERENT', 'EXPLOITATION'],
  ['ADHERENT', 'INFORMATIQUE'],
  ['EXPLOITATION', 'INFORMATIQUE'],
  ['EXPLOITATION', 'EXPLOITATION'],
  ['INFORMATIQUE', 'INFORMATIQUE'],
];

const cle = (a: GroupeMessagerie, b: GroupeMessagerie) => [a, b].sort().join('|');
const AUTORISEES = new Set(PAIRES.map(([a, b]) => cle(a, b)));

export const ROLES_MESSAGERIE: readonly string[] = Object.keys(GROUPE_PAR_ROLE);

export const ROLES_ADHERENT_MESSAGERIE: readonly string[] = Object.entries(GROUPE_PAR_ROLE)
  .filter(([, g]) => g === 'ADHERENT')
  .map(([r]) => r);

/** Le rôle a-t-il accès à la messagerie ? */
export function aAccesMessagerie(role: string | null | undefined): boolean {
  return !!role && role in GROUPE_PAR_ROLE;
}

/** Deux rôles peuvent-ils échanger ? (symétrique) */
export function peutEcrire(roleA: string | null | undefined, roleB: string | null | undefined): boolean {
  if (!roleA || !roleB) return false;
  const a = GROUPE_PAR_ROLE[roleA];
  const b = GROUPE_PAR_ROLE[roleB];
  return !!a && !!b && AUTORISEES.has(cle(a, b));
}

/** Rôles auxquels un rôle donné peut écrire. */
export function rolesInterlocuteurs(role: string | null | undefined): string[] {
  return ROLES_MESSAGERIE.filter((r) => peutEcrire(role, r));
}

// ---------------------------------------------------------------- fichiers joints

export const TAILLE_MAX_FICHIER = 5 * 1024 * 1024;
export const LONGUEUR_MAX_MESSAGE = 2000;

/** Types acceptés → signature (octets de tête) attendue ; aucun exécutable, script ou archive. */
export const TYPES_FICHIER: Readonly<Record<string, { extensions: string[]; signatures: number[][] | null }>> = {
  'image/jpeg': { extensions: ['jpg', 'jpeg'], signatures: [[0xff, 0xd8, 0xff]] },
  'image/png': { extensions: ['png'], signatures: [[0x89, 0x50, 0x4e, 0x47]] },
  'image/webp': { extensions: ['webp'], signatures: [[0x52, 0x49, 0x46, 0x46]] },
  'image/gif': { extensions: ['gif'], signatures: [[0x47, 0x49, 0x46, 0x38]] },
  'application/pdf': { extensions: ['pdf'], signatures: [[0x25, 0x50, 0x44, 0x46]] },
  'application/msword': { extensions: ['doc'], signatures: [[0xd0, 0xcf, 0x11, 0xe0]] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extensions: ['docx'], signatures: [[0x50, 0x4b, 0x03, 0x04]] },
  'application/vnd.ms-excel': { extensions: ['xls'], signatures: [[0xd0, 0xcf, 0x11, 0xe0]] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { extensions: ['xlsx'], signatures: [[0x50, 0x4b, 0x03, 0x04]] },
  'text/plain': { extensions: ['txt'], signatures: null },
  'text/csv': { extensions: ['csv'], signatures: null },
};

/** Vérifie type déclaré, extension et signature réelle du contenu. Renvoie le motif du refus, ou null si le fichier est accepté. */
export function refusFichier(f: { nom: string; type: string; taille: number; debut: Buffer }): string | null {
  if (f.taille <= 0) return 'Fichier vide.';
  if (f.taille > TAILLE_MAX_FICHIER) return 'Fichier trop volumineux (5 Mo maximum).';
  const regle = TYPES_FICHIER[f.type];
  if (!regle) return 'Type de fichier non autorisé (images, PDF, Word, Excel, texte, CSV).';
  const ext = f.nom.includes('.') ? f.nom.split('.').pop()!.toLowerCase() : '';
  if (!regle.extensions.includes(ext)) return 'L’extension du fichier ne correspond pas à son type.';
  if (regle.signatures && !regle.signatures.some((sig) => sig.every((o, i) => f.debut[i] === o))) {
    return 'Le contenu du fichier ne correspond pas à son type.';
  }
  if (!regle.signatures && f.debut.includes(0)) return 'Le fichier texte contient des données binaires.';
  return null;
}

/** Nom de fichier affichable : sans chemin ni caractère de contrôle, 120 caractères au plus. */
export function nomFichierSur(nom: string): string {
  const base = nom.split(/[\\/]/).pop() ?? 'fichier';
  // eslint-disable-next-line no-control-regex
  const propre = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '').trim();
  return (propre || 'fichier').slice(-120);
}

// ---------------------------------------------------------------- purge mensuelle

/** Premier instant du mois de `d` (UTC = heure d'Abidjan) : tout ce qui est antérieur est supprimé. */
export function debutDuMois(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

export const cleMois = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
