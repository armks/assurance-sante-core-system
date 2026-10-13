/**
 * Statut d'homologation d'un acte ou d'un médicament (référentiel de
 * l'organisation et catalogue national) — SOURCE UNIQUE des libellés.
 * MIROIR du schéma (`PROPOSE | HOMOLOGUE | SUSPENDU | RETIRE`).
 */
export const LIBELLE_STATUT_HOMOLOGATION: Record<string, string> = {
  PROPOSE: 'Proposé',
  HOMOLOGUE: 'Homologué',
  SUSPENDU: 'Suspendu',
  RETIRE: 'Retiré',
};

/**
 * Mode de cotation d'un acte (nomenclature) — SOURCE UNIQUE des libellés.
 * MIROIR du schéma (`ISOLE | GROUPE`, prisma/sql/080).
 */
export const LIBELLE_MODE_COTATION: Record<string, string> = {
  ISOLE: 'Isolé',
  GROUPE: 'Groupé',
};

/*
 * Catégories d'acte : plus de liste ici. Libellés et listes viennent du
 * référentiel unique `categories_acte` (API `GET /reference/categories-acte`,
 * prisma/sql/067), via `useCategoriesActe()` (components/categories-acte.tsx).
 */

/**
 * Repli d'affichage pour un code absent du référentiel : un code
 * (`SOINS_PALLIATIFS`) devient « Soins palliatifs » ; un texte déjà lisible est
 * rendu tel quel. Jamais le code brut en minuscules.
 */
export function libelleCodeLisible(valeur: string | null | undefined): string {
  const v = valeur?.trim();
  if (!v) return '—';
  if (/^[A-Z0-9_]+$/.test(v)) {
    const t = v.replace(/_+/g, ' ').trim().toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return v;
}

/**
 * ADR-009 — le référentiel médical de l'assureur est le catalogue national : seuls l'assureur informatique, le médecin conseil et le
 * pharmacien conseil l'ACTIVENT ou le DÉSACTIVENT (actes comme médicaments). Miroir de `ROLES_ACTIVATION_REFERENTIEL` (API) : ne fait que
 * masquer les boutons, l'API reste seule juge.
 */
export const ROLES_ACTIVATION_REFERENTIEL = ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_PHARMACIEN_CONSEIL'];

export function peutActiverReferentiel(roleChain: string[] | undefined): boolean {
  return (roleChain ?? []).some((r) => ROLES_ACTIVATION_REFERENTIEL.includes(r));
}
