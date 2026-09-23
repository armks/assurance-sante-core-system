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
}

export interface LigneImportValide {
  nom: string;
  prenom: string;
  telephone: string;
  email: string;
  dateNaissance: string;
}

export interface LigneImportErreur {
  ligne: number;
  donnees: Record<string, string>;
  erreurs: string[];
}

export interface ImportAdherentsResume {
  id: string;
  fichierNom: string;
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
  numeroCarte: string;
  lienParente: string;
  nom: string;
  prenom: string;
  dateNaissance: string;
  sexe: string;
  statut: string;
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
