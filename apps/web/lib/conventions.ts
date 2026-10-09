/**
 * Conventions établissement × assureur (ADR-008, lot 2) — SOURCE UNIQUE des libellés accentués et des types.
 * MIROIR du schéma (prisma/sql/081) : `PROPOSEE | VALIDEE | REFUSEE | ARCHIVEE`, `AMBULATOIRE | HOSPITALISATION`,
 * `PATIENT | REJET`.
 */
export const LIBELLE_STATUT_CONVENTION: Record<string, string> = {
  PROPOSEE: 'Proposée',
  VALIDEE: 'Validée',
  REFUSEE: 'Refusée',
  ARCHIVEE: 'Archivée',
};

export const TON_STATUT_CONVENTION: Record<string, 'info' | 'succes' | 'danger' | 'neutre' | 'attention'> = {
  PROPOSEE: 'attention',
  VALIDEE: 'succes',
  REFUSEE: 'danger',
  ARCHIVEE: 'neutre',
};

export const LIBELLE_CONTEXTE_CONVENTION: Record<string, string> = {
  AMBULATOIRE: 'Ambulatoire',
  HOSPITALISATION: 'Hospitalisation',
};

export const LIBELLE_POLITIQUE_DEPASSEMENT: Record<string, string> = {
  PATIENT: 'À la charge du patient',
  REJET: 'Rejeté (non facturable)',
};

export const LIBELLE_ROLE_ACTEUR: Record<string, string> = {
  ASSUREUR_INFORMATIQUE: 'Assurance informatique',
  ASSUREUR_INFORMATIQUE_ADJOINT: 'Assurance informatique (adjoint)',
  ASSUREUR_MEDECIN_CONSEIL: 'Médecin conseil',
  ASSUREUR_DIRECTION: 'Direction',
};

export interface ConventionResume {
  id: string;
  numero: string;
  version: number;
  statut: string;
  historique: boolean;
  dateDebut: string;
  dateFin: string | null;
  politiqueDepassement: string;
  aDocument: boolean;
  etablissement: { id: string; nom: string; code: string };
  nbValeurs: number;
  nbActes: number;
  motifRefus: string | null;
}

export interface ActeurConvention {
  id: string;
  role: string | null;
}

export interface ConventionDetail {
  id: string;
  numero: string;
  version: number;
  statut: string;
  historique: boolean;
  dateDebut: string;
  dateFin: string | null;
  politiqueDepassement: string;
  document: { nom: string | null; type: string | null } | null;
  etablissement: { id: string; nom: string; code: string; statut: string };
  precedente: { id: string; numero: string; version: number; statut: string } | null;
  suivantes: { id: string; numero: string; version: number; statut: string }[];
  saisiPar: ActeurConvention | null;
  dateSaisie: string;
  modifiePar: ActeurConvention | null;
  validePar: ActeurConvention | null;
  dateValidation: string | null;
  refusePar: ActeurConvention | null;
  dateRefus: string | null;
  motifRefus: string | null;
  valeurs: { id: string; lettreCleCode: string; contexte: string; valeur: string }[];
  actes: {
    id: string;
    referentielActeId: string;
    code: string;
    libelle: string;
    lettreCleCode: string | null;
    coefficient: string | null;
    prixForfaitaire: string | null;
    valeurLettreCle: string | null;
    dateDebut: string | null;
    dateFin: string | null;
  }[];
  moi: { id: string };
  blocagesValidation: string[];
}

export interface LettreCleActive {
  code: string;
  libelle: string;
  ordre: number;
}

export interface IndicateursConventions {
  etablissementsActifs: number;
  sansConventionValidee: number;
  etablissementsSansConvention: { id: string; nom: string; code: string }[];
  conventionsAValider: number;
}
