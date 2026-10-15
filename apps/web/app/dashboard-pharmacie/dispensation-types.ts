/** Types du vrai parcours de dispensation (module `pharmacy/`, verrou par
 * ligne de médicament) — distinct de `types.ts` (ancien mécanisme
 * `codes-ordonnance` du PROMPT 19, toujours en place mais plus utilisé par
 * cet écran). */

export interface LigneStock {
  id: string;
  denominationMedicament: string;
  prixPharmacie: string | null;
  disponible: boolean;
}

export type StatutLignePrescription = 'DISPONIBLE' | 'SERVIE';

export interface LignePrescriptionActive {
  id: string;
  denominationMedicament: string;
  dosage: string | null;
  posologie: string;
  duree: string | null;
  quantitePrescrite: number;
  statut: StatutLignePrescription;
  /** Prix national unique de référence (référentiel des médicaments), s'il est connu. */
  prixReference?: string | null;
}

export interface PrescriptionActive {
  id: string;
  numeroTraitement: string;
  statut: string;
  datePrescription: string;
  dateValidite: string;
  /** Facture non réglée déjà ouverte pour cette prescription (à reprendre, pas à refaire). */
  dispensationEnCours?: { id: string; statut: string } | null;
  lignes: LignePrescriptionActive[];
}

export interface PatientRecherche {
  qualite: 'TITULAIRE' | 'BENEFICIAIRE';
  nom: string;
  prenom: string;
  numeroCarte: string;
  statut: string;
  dateNaissance: string;
  sexe: string | null;
  lien: string;
  photoUrl: string | null;
  societe: string | null;
  police: string | null;
  /** Formule d'assurance (produit de la police). */
  produit: string | null;
  /** Contacts enregistrés du titulaire (masqués) — canaux d'envoi du code. */
  contacts: { canal: 'EMAIL' | 'SMS'; masque: string; actif: boolean; avertissement: string | null }[];
}

export interface RecherchePrescriptionsResultat {
  /** Seuil (%) de majoration au-delà duquel le comptoir alerte (paramètre de la plateforme). */
  seuilMajorationPourcent?: number;
  patient: PatientRecherche;
  ordonnances: PrescriptionActive[];
}

export type StatutDispensation =
  | 'EN_PREPARATION'
  | 'EN_ATTENTE_VALIDATION_PATIENT'
  | 'VALIDEE'
  | 'PAYEE'
  | 'ANNULEE';

export interface LigneDispensationDetail {
  id: string;
  ligneOrdonnanceId: string;
  denominationMedicament: string;
  medicamentSubstitue: string | null;
  motifSubstitution: string | null;
  quantite: number;
  prixUnitaire: string;
  montantLigne: string;
  /** Remboursement pharmacie : garanties.tauxCouverture appliqué (catégorie PHARMACIE). */
  montantAssurance: string;
  montantPatient: string;
  prixReference?: string | null;
  majorationPourcent?: string | null;
  majorationAnormale?: boolean;
}

export interface ReclamationDispensation {
  id: string;
  statut: string;
}

export interface DispensationDetail {
  id: string;
  statut: StatutDispensation;
  montantTotal: string;
  /** Part assurance / part patient — agrégées sur toutes les lignes. */
  montantAssurance: string;
  montantPatient: string;
  datePreparation: string;
  dateValidationPatient: string | null;
  datePaiement: string | null;
  lignes: LigneDispensationDetail[];
  /** Présent uniquement après confirmation du paiement (réclamation soumise à l'adjudication). */
  reclamation?: ReclamationDispensation | null;
}

export interface PatientDispensation {
  nom: string;
  prenom: string;
  numeroCarte: string;
}

export interface LigneDispensationResume {
  denominationMedicament: string;
  quantite: number;
  montantLigne: string;
  /** Ligne contestée : exclue des parts assurance / assuré. */
  enLitige?: boolean;
}

/** Ligne de la liste `GET /pharmacy/dispensations` — pharmacien (tous statuts) /
 * comptable (statut=PAYEE). Le code de confirmation n'est jamais inclus. */
export interface DispensationResume {
  id: string;
  statut: StatutDispensation;
  montantTotal: string;
  montantAssurance: string;
  montantPatient: string;
  datePreparation: string;
  dateValidationPatient: string | null;
  datePaiement: string | null;
  patient: PatientDispensation | null;
  /** Espace adhérent : nom de la pharmacie et code de confirmation (visible tant qu'il attend sa validation). */
  pharmacie?: string;
  pharmacieDetail?: { nom: string; code: string; type: string; localisation: string | null; adresse: string | null; telephone: string | null };
  code?: string;
  /** Société (souscripteur) de l'adhérent. */
  societe?: string | null;
  /** Formule d'assurance (produit de la police). */
  formule?: string | null;
  lignes: LigneDispensationResume[];
}

/** Cumul du périmètre filtré (toutes les pages). */
export interface RecapDispensations {
  nombre: number;
  montantTotal: string;
  montantAssurance: string;
  montantPatient: string;
}
