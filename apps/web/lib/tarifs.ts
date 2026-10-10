/**
 * Tarifs — SOURCE UNIQUE des libellés accentués du barème (ADR-008, lot 6) : règle d'origine du tarif, statut du tarif
 * proposé, statut du tarif d'une ligne, codes de rejet. MIROIR du schéma (prisma/sql/082-084) et du microservice Java
 * (`TarifResolu.Regle`, `CodesRejet`). Un écran n'affiche JAMAIS un code brut : il passe par `libelleDe`.
 */

/** Règle d'origine du tarif reconnu (trace figée sur la ligne de facturation). */
export const LIBELLE_REGLE_ORIGINE: Record<string, string> = {
  FORFAIT: 'Forfait de la convention',
  VALEUR_PROPRE: 'Valeur de lettre-clé propre à l’acte',
  VALEUR_LETTRE_CLE: 'Valeur de la lettre-clé × coefficient',
  AUCUNE_CONVENTION: 'Prix affiché (aucune convention en vigueur)',
  TARIF_PROPOSE: 'Tarif proposé par l’établissement',
};

/** Statut d'un tarif proposé par l'établissement (lot 4-5). */
export const LIBELLE_STATUT_TARIF_PROPOSE: Record<string, string> = {
  PROPOSE: 'En cours d’examen',
  VALIDE: 'Validé',
  AJUSTE: 'Ajusté',
  REFUSE: 'Refusé',
};

/** Mêmes statuts vus de la file du médecin conseil. */
export const LIBELLE_STATUT_TARIF_A_EXAMINER: Record<string, string> = {
  ...LIBELLE_STATUT_TARIF_PROPOSE,
  PROPOSE: 'À examiner',
};

export const TON_STATUT_TARIF_PROPOSE: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  PROPOSE: 'attention',
  VALIDE: 'succes',
  AJUSTE: 'succes',
  REFUSE: 'danger',
};

/** Statut du tarif d'une ligne (trace) : tarifable, non tarifable, non applicable. */
export const LIBELLE_STATUT_TARIF: Record<string, string> = {
  TARIFABLE: 'Tarifé',
  NON_TARIFABLE: 'Non tarifable',
  NON_APPLICABLE: 'Sans tarif conventionné',
};

/** Codes de rejet / de revue liés au tarif et à la date des soins. */
export const LIBELLE_CODE_REJET: Record<string, string> = {
  E001: 'La police ne couvre pas la date des soins',
  E006: 'Plafond annuel atteint',
  E010: 'Montant élevé : revue manuelle',
  E012: 'Soins antérieurs au début de la police',
  E013: 'Date des soins postérieure à la déclaration',
  E014: 'Déclaration hors délai',
  E015: 'Prix affiché supérieur au tarif reconnu (dépassement refusé par la convention)',
  E016: 'Acte non tarifable : un tarif peut être proposé par l’établissement',
  E017: 'Tarif proposé en cours d’examen (montant provisoire)',
};

/** Libellé d'un code ; à défaut, une forme lisible (jamais le code brut en majuscules avec des soulignés). */
export function libelleDe(table: Record<string, string>, code: string | null | undefined): string {
  if (!code) return '—';
  if (table[code]) return table[code];
  const lisible = code.toLowerCase().replace(/_/g, ' ');
  return lisible.charAt(0).toUpperCase() + lisible.slice(1);
}
