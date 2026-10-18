import { dateFr, entier, francs, type RapportDocument } from './rapport-document';

const LIBELLE_LIEN: Record<string, string> = { TITULAIRE: 'Titulaire', CONJOINT: 'Conjoint(e)', ENFANT: 'Enfant', PERE: 'Père', MERE: 'Mère', AUTRE: 'Autre' };
const heureUtc = (d: Date) => `${dateFr(d)} à ${d.toISOString().slice(11, 16)} UTC`;

export interface PatientFacture {
  nom: string;
  numeroCarte: string | null;
  lien: string;
  societe: string | null;
  formule: string | null;
}

export interface DonneesFactureSoins {
  numeroFacture: string;
  dateEmission: Date;
  /** PARTIELLE : une partie des actes du dossier (le dossier continue ou d'autres actes restent à facturer) ; DEFINITIVE : tous les actes réalisés sont facturés et le dossier est clos */
  typeFacture: 'PARTIELLE' | 'DEFINITIVE';
  etablissement: { nom: string; code: string; adresse: string | null; telephone: string | null };
  patient: PatientFacture;
  dossier: { numero: string; ouvertLe: Date; typeVisite: string | null };
  lignes: { libelle: string; code: string | null; quantite: number; prixUnitaire: number; montant: number; assurance: number; patient: number }[];
  totaux: { total: number; assurance: number; patient: number };
  /** validation du code de facturation par le patient = règlement de sa part */
  patientValideLe: Date | null;
  reglementAssureurLe: Date | null;
  editePar: string;
  edite: Date;
}

/** Facture de soins d'un établissement sanitaire, partielle ou définitive, dont la part du patient est réglée (document imprimable PDF / Word). */
export function documentFactureSoins(d: DonneesFactureSoins): RapportDocument {
  const definitive = d.typeFacture === 'DEFINITIVE';
  return {
    titre: `Facture de soins ${definitive ? 'définitive' : 'partielle'} n° ${d.numeroFacture}`,
    sousTitre: `${d.etablissement.nom}${d.etablissement.adresse ? ` — ${d.etablissement.adresse}` : ''}${d.etablissement.telephone ? ` — Tél. ${d.etablissement.telephone}` : ''}`,
    organisation: d.etablissement.nom,
    libelleCriteres: 'Informations',
    filtres: [
      { libelle: 'Facture', valeur: `${definitive ? 'définitive (tous les actes réalisés du dossier)' : 'partielle (une partie des actes du dossier)'} — émise le ${dateFr(d.dateEmission)}` },
      { libelle: 'Patient', valeur: `${d.patient.nom} (${LIBELLE_LIEN[d.patient.lien] ?? d.patient.lien})` },
      { libelle: 'N° de carte', valeur: d.patient.numeroCarte ?? '—' },
      ...(d.patient.societe ? [{ libelle: 'Société', valeur: d.patient.societe }] : []),
      ...(d.patient.formule ? [{ libelle: 'Formule', valeur: d.patient.formule }] : []),
      { libelle: 'Dossier de soins', valeur: `${d.dossier.numero} — ouvert le ${dateFr(d.dossier.ouvertLe)}` },
      {
        libelle: 'Règlement du patient',
        valeur: d.patientValideLe ? `part du patient réglée et validée le ${dateFr(d.patientValideLe)}` : 'non réglée',
      },
    ],
    genereLe: heureUtc(d.edite),
    genererPar: d.editePar,
    sections: [
      {
        titre: 'Montants',
        indicateurs: [
          { libelle: 'Montant total des soins', valeur: francs(d.totaux.total) },
          { libelle: 'Pris en charge par l’assurance', valeur: francs(d.totaux.assurance) },
          { libelle: 'Part du patient (réglée)', valeur: francs(d.totaux.patient) },
        ],
      },
      {
        titre: 'Détail des actes facturés',
        tableau: {
          colonnes: [
            { titre: 'Acte', poids: 4 },
            { titre: 'Code', poids: 1.2 },
            { titre: 'Qté', align: 'droite', poids: 0.6 },
            { titre: 'Prix unitaire', align: 'droite', poids: 1.4 },
            { titre: 'Montant', align: 'droite', poids: 1.4 },
            { titre: 'Part assurance', align: 'droite', poids: 1.4 },
            { titre: 'Part patient', align: 'droite', poids: 1.4 },
          ],
          lignes: d.lignes.map((l) => [l.libelle, l.code ?? '—', entier(l.quantite), francs(l.prixUnitaire), francs(l.montant), francs(l.assurance), francs(l.patient)]),
          total: ['Total', '', '', '', francs(d.totaux.total), francs(d.totaux.assurance), francs(d.totaux.patient)],
          note: definitive
            ? 'Facture définitive : tous les actes réalisés du dossier sont facturés.'
            : 'Facture partielle : elle ne couvre qu’une partie des actes du dossier ; les actes restants feront l’objet d’une autre facture.',
        },
      },
      {
        titre: 'Règlement',
        tableau: {
          colonnes: [{ titre: 'Élément', poids: 3 }, { titre: 'Situation', poids: 4 }],
          lignes: [
            ['Part du patient', d.patientValideLe ? `Réglée — code de facturation validé par le patient le ${dateFr(d.patientValideLe)}` : 'Non réglée'],
            ['Part de l’assurance', d.reglementAssureurLe ? `Réglée à l’établissement le ${dateFr(d.reglementAssureurLe)}` : 'À régler par l’assurance à l’établissement'],
          ],
        },
      },
    ],
  };
}

export interface DonneesFacturePharmacie {
  numeroFacture: string;
  datePreparation: Date;
  datePaiement: Date | null;
  typeFacture: 'PARTIELLE' | 'DEFINITIVE';
  pharmacie: { nom: string; code: string; adresse: string | null; telephone: string | null };
  patient: PatientFacture;
  ordonnance: { date: Date; dossierNumero: string };
  lignes: { medicament: string; quantite: number; prixUnitaire: number; montant: number; assurance: number; patient: number }[];
  totaux: { total: number; assurance: number; patient: number };
  editePar: string;
  edite: Date;
}

/** Facture de médicaments d'une pharmacie (dispensation payée), partielle ou définitive (document imprimable PDF / Word). */
export function documentFacturePharmacie(d: DonneesFacturePharmacie): RapportDocument {
  const definitive = d.typeFacture === 'DEFINITIVE';
  return {
    titre: `Facture de médicaments ${definitive ? 'définitive' : 'partielle'} n° ${d.numeroFacture}`,
    sousTitre: `${d.pharmacie.nom}${d.pharmacie.adresse ? ` — ${d.pharmacie.adresse}` : ''}${d.pharmacie.telephone ? ` — Tél. ${d.pharmacie.telephone}` : ''}`,
    organisation: d.pharmacie.nom,
    libelleCriteres: 'Informations',
    filtres: [
      { libelle: 'Facture', valeur: `${definitive ? 'définitive (tous les médicaments de l’ordonnance délivrés)' : 'partielle (une partie des médicaments de l’ordonnance)'} — du ${dateFr(d.datePreparation)}` },
      { libelle: 'Patient', valeur: `${d.patient.nom} (${LIBELLE_LIEN[d.patient.lien] ?? d.patient.lien})` },
      { libelle: 'N° de carte', valeur: d.patient.numeroCarte ?? '—' },
      ...(d.patient.societe ? [{ libelle: 'Société', valeur: d.patient.societe }] : []),
      { libelle: 'Ordonnance', valeur: `du ${dateFr(d.ordonnance.date)} — dossier de soins ${d.ordonnance.dossierNumero}` },
      { libelle: 'Règlement du patient', valeur: d.datePaiement ? `part du patient réglée le ${dateFr(d.datePaiement)}` : 'non réglée' },
    ],
    genereLe: heureUtc(d.edite),
    genererPar: d.editePar,
    sections: [
      {
        titre: 'Montants',
        indicateurs: [
          { libelle: 'Montant total des médicaments', valeur: francs(d.totaux.total) },
          { libelle: 'Pris en charge par l’assurance', valeur: francs(d.totaux.assurance) },
          { libelle: 'Part du patient (réglée)', valeur: francs(d.totaux.patient) },
        ],
      },
      {
        titre: 'Détail des médicaments délivrés',
        tableau: {
          colonnes: [
            { titre: 'Médicament', poids: 4 },
            { titre: 'Qté', align: 'droite', poids: 0.6 },
            { titre: 'Prix unitaire', align: 'droite', poids: 1.4 },
            { titre: 'Montant', align: 'droite', poids: 1.4 },
            { titre: 'Part assurance', align: 'droite', poids: 1.4 },
            { titre: 'Part patient', align: 'droite', poids: 1.4 },
          ],
          lignes: d.lignes.map((l) => [l.medicament, entier(l.quantite), francs(l.prixUnitaire), francs(l.montant), francs(l.assurance), francs(l.patient)]),
          total: ['Total', '', '', francs(d.totaux.total), francs(d.totaux.assurance), francs(d.totaux.patient)],
          note: definitive
            ? 'Facture définitive : tous les médicaments de l’ordonnance ont été délivrés.'
            : 'Facture partielle : elle ne couvre qu’une partie des médicaments de l’ordonnance ; le solde sera délivré et facturé séparément.',
        },
      },
    ],
  };
}
