import PDFDocument from 'pdfkit';
import type { ColonneRapport, RapportDocument, TableauRapport } from './rapport-document';

const MARGE = 36;
const COULEUR_PRIMAIRE = '#4f46e5';
const COULEUR_TEXTE = '#1f2937';
const COULEUR_DISCRET = '#6b7280';
const COULEUR_ENTETE = '#eef2ff';
const COULEUR_ZEBRE = '#f9fafb';

/** Largeurs de colonnes proportionnelles aux poids, sur la largeur utile. */
function largeurs(colonnes: ColonneRapport[], total: number): number[] {
  const somme = colonnes.reduce((s, c) => s + (c.poids ?? 1), 0);
  return colonnes.map((c) => ((c.poids ?? 1) / somme) * total);
}

/** Génère le PDF (A4 paysage, en-tête, tableaux à en-tête répété, pied de page numéroté) d'un rapport. */
export function genererPdf(rapport: RapportDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: MARGE,
      bufferPages: true,
      info: { Title: rapport.titre, Author: rapport.organisation },
    });
    const morceaux: Buffer[] = [];
    doc.on('data', (m: Buffer) => morceaux.push(m));
    doc.on('end', () => resolve(Buffer.concat(morceaux)));
    doc.on('error', reject);

    const largeurUtile = doc.page.width - 2 * MARGE;
    const bas = () => doc.page.height - MARGE - 18;
    const verifierPlace = (hauteur: number) => {
      if (doc.y + hauteur > bas()) doc.addPage();
    };

    // ---- en-tête
    doc.rect(0, 0, doc.page.width, 8).fill(COULEUR_PRIMAIRE);
    doc.fillColor(COULEUR_PRIMAIRE).font('Helvetica-Bold').fontSize(18).text(rapport.titre, MARGE, 28, { width: largeurUtile });
    if (rapport.sousTitre) doc.fillColor(COULEUR_DISCRET).font('Helvetica').fontSize(10).text(rapport.sousTitre);
    doc
      .moveDown(0.3)
      .fillColor(COULEUR_DISCRET)
      .font('Helvetica')
      .fontSize(9)
      .text(`${rapport.organisation} — généré le ${rapport.genereLe}${rapport.genererPar ? ` par ${rapport.genererPar}` : ''}`);
    if (rapport.filtres.length) {
      doc.moveDown(0.6).fillColor(COULEUR_TEXTE).font('Helvetica-Bold').fontSize(9).text(rapport.libelleCriteres ?? 'Critères du rapport');
      doc.font('Helvetica').fontSize(9).fillColor(COULEUR_TEXTE);
      for (const f of rapport.filtres) doc.text(`• ${f.libelle} : ${f.valeur}`, { width: largeurUtile });
    }

    const dessinerTableau = (t: TableauRapport) => {
      const larg = largeurs(t.colonnes, largeurUtile);
      const pad = 4;
      const hauteurLigne = (cellules: string[], gras: boolean) => {
        doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        return Math.max(...cellules.map((c, i) => doc.heightOfString(c ?? '', { width: larg[i] - 2 * pad }))) + 2 * pad - 2;
      };
      const ligne = (cellules: string[], opts: { gras?: boolean; fond?: string; couleur?: string }) => {
        const h = hauteurLigne(cellules, !!opts.gras);
        verifierPlace(h);
        let x = MARGE;
        const y = doc.y;
        if (opts.fond) doc.rect(MARGE, y, largeurUtile, h).fill(opts.fond);
        doc.fillColor(opts.couleur ?? COULEUR_TEXTE).font(opts.gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        cellules.forEach((c, i) => {
          const a = t.colonnes[i].align;
          doc.text(c ?? '', x + pad, y + pad - 1, {
            width: larg[i] - 2 * pad,
            align: a === 'droite' ? 'right' : a === 'centre' ? 'center' : 'left',
          });
          x += larg[i];
        });
        doc.y = y + h;
        doc.x = MARGE;
      };
      const enTete = () => ligne(t.colonnes.map((c) => c.titre), { gras: true, fond: COULEUR_ENTETE, couleur: COULEUR_PRIMAIRE });
      verifierPlace(40);
      enTete();
      t.lignes.forEach((l, i) => {
        if (doc.y + hauteurLigne(l, false) > bas()) {
          doc.addPage();
          enTete();
        }
        ligne(l, { fond: i % 2 ? COULEUR_ZEBRE : undefined });
      });
      if (t.total) ligne(t.total, { gras: true, fond: COULEUR_ENTETE });
      if (t.note) {
        doc.moveDown(0.3).fillColor(COULEUR_DISCRET).font('Helvetica-Oblique').fontSize(8).text(t.note, MARGE, doc.y, { width: largeurUtile });
      }
    };

    for (const s of rapport.sections) {
      verifierPlace(70);
      doc.moveDown(1).fillColor(COULEUR_PRIMAIRE).font('Helvetica-Bold').fontSize(12).text(s.titre, MARGE, doc.y, { width: largeurUtile });
      doc.moveTo(MARGE, doc.y + 1).lineTo(MARGE + largeurUtile, doc.y + 1).strokeColor(COULEUR_PRIMAIRE).lineWidth(0.8).stroke();
      doc.moveDown(0.5);
      if (s.indicateurs?.length) {
        const parLigne = Math.min(4, s.indicateurs.length);
        const l = largeurUtile / parLigne;
        for (let i = 0; i < s.indicateurs.length; i += parLigne) {
          verifierPlace(46);
          const y = doc.y;
          s.indicateurs.slice(i, i + parLigne).forEach((k, j) => {
            const x = MARGE + j * l;
            doc.roundedRect(x + 2, y, l - 6, 40, 4).fill(COULEUR_ENTETE);
            doc.fillColor(COULEUR_DISCRET).font('Helvetica').fontSize(8).text(k.libelle, x + 8, y + 6, { width: l - 18 });
            doc.fillColor(COULEUR_PRIMAIRE).font('Helvetica-Bold').fontSize(13).text(k.valeur, x + 8, y + 19, { width: l - 18 });
          });
          doc.y = y + 48;
          doc.x = MARGE;
        }
      }
      if (s.tableau) dessinerTableau(s.tableau);
    }

    // ---- pied de page sur chaque page (marge basse neutralisée : écrire sous la marge ajouterait une page vide)
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      const margeBasse = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .fillColor(COULEUR_DISCRET)
        .font('Helvetica')
        .fontSize(8)
        .text(`${rapport.titre} — page ${i + 1} / ${pages.count}`, MARGE, doc.page.height - MARGE + 6, {
          width: largeurUtile,
          align: 'center',
          lineBreak: false,
        });
      doc.page.margins.bottom = margeBasse;
    }
    doc.end();
  });
}
