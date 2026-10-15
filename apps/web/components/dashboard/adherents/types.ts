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
    produit: { nom: string; version: number; niveauAccesEtablissement?: string } | null;
  } | null;
  _count?: { beneficiaires: number };
  /** Chemin de stockage (bucket privé `photos`) — jamais affiché directement,
   * résolu en URL signée par `chargerPhotosFamille` (lib/photos.ts). */
  photoUrl?: string | null;
  /** Renseigné uniquement pendant `statut = 'PROPOSE_SORTANT'`. */
  statutSortantCible?: string | null;
  motifSortie?: string | null;
  /** Renseignés par la liste (colonnes de la fiche) — la date de validation conditionne l'invitation. */
  email?: string | null;
  telephone?: string | null;
  dateValidation?: string | null;
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
  /** Mouvements de personnel à effet différé : mois (1er du mois) auquel les
   * ADHERENT de ce lot deviennent éligibles à la facturation. `null` hors de
   * ce contexte (comportement historique). */
  moisEffet?: string | null;
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
  /** Contacts facultatifs. */
  telephone?: string | null;
  email?: string | null;
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

/** Proposition d'adhérent ou de bénéficiaire (une ligne par proposition, prisma/sql/086). */
export interface PropositionMembre {
  id: string;
  type: 'ADHERENT' | 'BENEFICIAIRE';
  statut: 'EN_ATTENTE' | 'VALIDEE' | 'REJETEE' | 'RETIREE';
  souscripteurId: string;
  societe: string | null;
  nom: string;
  prenom: string;
  dateNaissance: string;
  sexe: string;
  formule: string | null;
  telephone: string | null;
  email: string | null;
  /** Entrant : 1er du mois d'effet (AAAA-MM-JJ) ; null = effet immédiat. */
  moisEffet?: string | null;
  /** Adhérent créé à la validation (accès à sa fiche et au lien d'invitation). */
  adherentCreeId?: string | null;
  lienParente: string | null;
  adherentParentId: string | null;
  motifRejet: string | null;
  dateProposition: string;
  dateDecision: string | null;
  /** « Action possible ? » décidée par le serveur (rôle, statut) — l'écran ne fait que l'afficher. */
  actions: Record<'valider' | 'rejeter' | 'retirer', { possible: boolean; raison: string | null }>;
}
