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
}

export interface PrescriptionActive {
  id: string;
  numeroTraitement: string;
  statut: string;
  datePrescription: string;
  dateValidite: string;
  lignes: LignePrescriptionActive[];
}

export interface PatientRecherche {
  qualite: 'TITULAIRE' | 'BENEFICIAIRE';
  nom: string;
  prenom: string;
  numeroCarte: string;
  statut: string;
}

export interface RecherchePrescriptionsResultat {
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
  lignes: LigneDispensationResume[];
}
