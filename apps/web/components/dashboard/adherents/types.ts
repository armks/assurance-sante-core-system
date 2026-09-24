export interface OptionRef {
  id: string;
  nom: string;
  type?: string;
}

export interface PoliceRef {
  id: string;
  numeroPolice: string;
  statut: string;
  souscripteurId: string;
  produit: { nom: string; version: number } | null;
}

export interface AdherentListe {
  id: string;
  numeroAdherent: string;
  numeroCarte: string;
  nom: string;
  prenom: string;
  /** `null` pour un adhérent créé par import Excel en masse (colonne non collectée). */
  sexe: string | null;
  statut: string;
  souscripteurId: string;
  souscripteur: { id: string; nom: string; type: string } | null;
  police: {
    id: string;
    numeroPolice: string;
    statut: string;
    produit: { nom: string; version: number } | null;
  } | null;
  _count?: { beneficiaires: number };
  /** Chemin de stockage (bucket privé `photos`) — jamais affiché directement,
   * résolu via `obtenirPhotoAdherent`/`obtenirPhotoBeneficiaire`. */
  photoUrl?: string | null;
}

/** Adhérent PRINCIPAL — issu d'un import Excel OU d'une proposition société. */
export interface LigneAdherentValide {
  type: 'ADHERENT';
  nom: string;
  prenom: string;
  telephone: string;
  email: string;
  dateNaissance: string;
}

/** Bénéficiaire proposé par une société, rattaché à un adhérent EXISTANT
 * (`adherentNom` : instantané d'affichage uniquement). */
export interface LigneBeneficiaireValide {
  type: 'BENEFICIAIRE';
  adherentId: string;
  adherentNom: string;
  lienParente: string;
  nom: string;
  prenom: string;
  dateNaissance: string;
  sexe: string;
}

/** Une ligne d'import Excel legacy peut ne pas porter `type` (fichiers créés
 * avant l'introduction des propositions société) — toujours un ADHERENT. */
export type LigneImportValide =
  | LigneAdherentValide
  | LigneBeneficiaireValide
  | (Omit<LigneAdherentValide, 'type'> & { type?: undefined });

export interface LigneImportErreur {
  ligne: number;
  donnees: Record<string, string>;
  erreurs: string[];
}

export interface ImportAdherentsResume {
  id: string;
  /** `null` pour un brouillon de propositions société (jamais un import Excel). */
  fichierNom: string | null;
  statut: string;
  nbLignesTotal: number;
  nbLignesValides: number;
  nbLignesErreur: number;
  lignesValides: LigneImportValide[];
  erreursDetail: LigneImportErreur[];
  souscripteur: { id: string; nom: string };
  importePar: { role: string };
  validePar: { role: string } | null;
  createdAt: string;
  dateValidation: string | null;
}

export interface Beneficiaire {
  id: string;
  /** `null` tant que la double validation (EN_ATTENTE_SOCIETE →
   * EN_ATTENTE_ASSUREUR) n'a pas abouti — attribué à ACTIF uniquement. */
  numeroCarte: string | null;
  lienParente: string;
  nom: string;
  prenom: string;
  dateNaissance: string;
  sexe: string;
  /** EN_ATTENTE_SOCIETE | EN_ATTENTE_ASSUREUR | ACTIF | SUSPENDU | RADIE. */
  statut: string;
  photoUrl?: string | null;
}

export interface AdherentDetail extends AdherentListe {
  dateNaissance: string;
  /** Renseignés pour un adhérent créé par import Excel en masse. */
  email: string | null;
  telephone: string | null;
  ibanOuRib: string | null;
  banqueNom: string | null;
  modePaiementPrefere: string | null;
  createdAt: string;
  /** Validation par ASSUREUR_EXPLOITATION — gouverne la coupure de
   * facturation mensuelle (billing/). `null` tant que non validé. */
  dateValidation: string | null;
  beneficiaires: Beneficiaire[];
  police:
    | (AdherentListe['police'] & {
        dateDebut: string | null;
        dateFin: string | null;
      })
    | null;
}
