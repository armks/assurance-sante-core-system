import PDFDocument from 'pdfkit';
import { entier, francs } from '../reporting/rapport-document';

export const TYPES_IMPRIMANTE = ['THERMIQUE_58', 'THERMIQUE_80', 'A4'] as const;
export type TypeImprimante = (typeof TYPES_IMPRIMANTE)[number];

export const LIBELLE_IMPRIMANTE: Record<TypeImprimante, string> = {
  THERMIQUE_58: 'Imprimante thermique 58 mm',
  THERMIQUE_80: 'Imprimante thermique 80 mm',
  A4: 'Imprimante A4',
};

const MM = 72 / 25.4;

export interface DonneesRecu {
  imprimante: TypeImprimante;
  emetteur: { nom: string; code: string; adresse: string | null; telephone: string | null; identifiantFiscal: string | null };
  enTete: string | null;
  pied: string | null;
  afficherDetail: boolean;
  numero: string;
  emisLe: Date;
  /** 0 : original ; n : n-ième réimpression (« DUPLICATA ») */
  duplicata: number;
  patient: { nom: string; numeroCarte: string | null; lien: string; societe: string | null };
  /** document réglé : « Facture de soins » / « Facture de médicaments » */
  reference: { libelle: string; numero: string; dossier: string };
  lignes: { libelle: string; quantite: number; prixUnitaire: number; montantPatient: number }[];
  totaux: { total: number; assurance: number; patient: number };
  paiement: { montant: number; date: Date; mode: string };
  caissier: string;
}

const LIBELLE_LIEN: Record<string, string> = { TITULAIRE: 'Titulaire', CONJOINT: 'Conjoint(e)', ENFANT: 'Enfant', PERE: 'Père', MERE: 'Mère', AUTRE: 'Autre' };
const dateHeure = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()} ${d.toISOString().slice(11, 16)}`;

/** Dessine le reçu sur le document et renvoie l'ordonnée finale (sert aussi à mesurer la hauteur d'un ticket thermique). */
function dessiner(doc: PDFKit.PDFDocument, d: DonneesRecu, marge: number, echelle: number): number {
  const l = doc.page.width - 2 * marge;
  const t = (n: number) => n * echelle;
  const thermique = d.imprimante !== 'A4';
  doc.fillColor('#000000');

  const centre = (texte: string, taille: number, gras = false) => {
    doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(t(taille)).text(texte, marge, doc.y, { width: l, align: 'center' });
  };
  const trait = () => {
    doc.moveDown(0.3);
    const y = doc.y;
    doc.save().lineWidth(0.6).dash(2, { space: 2 }).moveTo(marge, y).lineTo(marge + l, y).stroke().undash().restore();
    doc.y = y + t(4);
  };
  const ligne = (gauche: string, droite: string, gras = false, taille = 8) => {
    const y = doc.y;
    doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(t(taille));
    const lD = doc.widthOfString(droite);
    doc.text(gauche, marge, y, { width: Math.max(l - lD - 6, l * 0.4), lineBreak: true });
    const yFin = doc.y;
    doc.text(droite, marge + l - lD, y, { width: lD + 2, lineBreak: false });
    doc.y = Math.max(yFin, y + doc.currentLineHeight());
  };

  // ---- en-tête de l'émetteur
  centre(d.emetteur.nom.toUpperCase(), 10.5, true);
  const adresse = [d.emetteur.adresse, d.emetteur.telephone ? `Tél. ${d.emetteur.telephone}` : null].filter(Boolean).join(' - ');
  if (adresse) centre(adresse, 7.5);
  if (d.emetteur.identifiantFiscal) centre(d.emetteur.identifiantFiscal, 7.5);
  if (d.enTete) centre(d.enTete, 7.5);
  trait();

  centre('REÇU DE CAISSE', 11, true);
  centre(`N° ${d.numero}`, 9, true);
  if (d.duplicata > 0) centre(`DUPLICATA n° ${d.duplicata}`, 8.5, true);
  else centre('ORIGINAL', 7.5);
  ligne('Date du paiement', dateHeure(d.paiement.date));
  ligne('Émis le', dateHeure(d.emisLe));
  ligne('Caisse', d.caissier);
  trait();

  // ---- patient et document réglé
  ligne('Patient', d.patient.nom, true);
  if (d.patient.numeroCarte) ligne('N° de carte', d.patient.numeroCarte);
  ligne('Lien', LIBELLE_LIEN[d.patient.lien] ?? d.patient.lien);
  if (d.patient.societe) ligne('Société', d.patient.societe);
  ligne(d.reference.libelle, d.reference.numero);
  ligne('Dossier', d.reference.dossier);
  trait();

  // ---- détail
  if (d.afficherDetail && d.lignes.length > 0) {
    doc.font('Helvetica-Bold').fontSize(t(8)).text('DÉTAIL', marge, doc.y, { width: l });
    doc.moveDown(0.2);
    for (const x of d.lignes) {
      if (thermique) {
        doc.font('Helvetica').fontSize(t(8)).text(x.libelle, marge, doc.y, { width: l });
        ligne(`  ${entier(x.quantite)} x ${entier(x.prixUnitaire)}`, francs(x.montantPatient), false, 7.5);
      } else {
        ligne(`${x.libelle}  (${entier(x.quantite)} x ${entier(x.prixUnitaire)} F)`, francs(x.montantPatient));
      }
    }
    trait();
  }

  // ---- montants
  ligne('Montant total des soins', francs(d.totaux.total));
  ligne('Pris en charge par l’assurance', francs(d.totaux.assurance));
  ligne('Part du patient', francs(d.totaux.patient), true);
  trait();

  // ---- justification du paiement
  ligne('MONTANT PAYÉ', francs(d.paiement.montant), true, 11);
  ligne('Reste à payer', francs(Math.max(d.totaux.patient - d.paiement.montant, 0)));
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(t(7.5)).text(`Mode de règlement : ${d.paiement.mode}`, marge, doc.y, { width: l });
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(t(7)).text(
    `Atteste que ${d.patient.nom} a réglé sa part de ${francs(d.paiement.montant)} le ${dateHeure(d.paiement.date)} (${d.reference.libelle.toLowerCase()} n° ${d.reference.numero}).`,
    marge,
    doc.y,
    { width: l },
  );
  trait();

  if (d.pied) centre(d.pied, 7.5);
  centre('Merci de conserver ce reçu.', 7);
  doc.moveDown(0.5);
  return doc.y;
}

/** Génère le reçu de caisse au format de l'imprimante : ticket thermique (58 ou 80 mm, hauteur ajustée au contenu) ou page A4. */
export function genererRecuPdf(d: DonneesRecu): Promise<Buffer> {
  const thermique = d.imprimante !== 'A4';
  const largeur = d.imprimante === 'THERMIQUE_58' ? 58 * MM : d.imprimante === 'THERMIQUE_80' ? 80 * MM : 0;
  const marge = thermique ? 6 : 56;
  const echelle = d.imprimante === 'THERMIQUE_58' ? 0.9 : d.imprimante === 'THERMIQUE_80' ? 1 : 1.25;

  const fabriquer = (hauteur: number) =>
    new PDFDocument({
      size: thermique ? [largeur, hauteur] : 'A4',
      margin: marge,
      autoFirstPage: true,
      info: { Title: `Reçu de caisse ${d.numero}`, Author: d.emetteur.nom },
    });

  return new Promise((resolve, reject) => {
    try {
      // 1re passe : mesure de la hauteur (le ticket thermique n'a pas de pagination, il s'arrête au contenu)
      let hauteur = 0;
      if (thermique) {
        const mesure = fabriquer(20000);
        mesure.on('data', () => undefined);
        hauteur = dessiner(mesure, d, marge, echelle) + marge;
        mesure.end();
      }
      const doc = fabriquer(hauteur);
      const morceaux: Buffer[] = [];
      doc.on('data', (m: Buffer) => morceaux.push(m));
      doc.on('end', () => resolve(Buffer.concat(morceaux)));
      doc.on('error', reject);
      dessiner(doc, d, marge, echelle);
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
