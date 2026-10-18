import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  PageOrientation,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { RapportDocument, SectionRapport, TableauRapport } from './rapport-document';

const COULEUR = '4F46E5';
const FOND_ENTETE = 'EEF2FF';
const FOND_ZEBRE = 'F9FAFB';
const LARGEUR_UTILE = 15000; // twips : A4 paysage, marges d'environ 1,2 cm

const alignement = (a?: string) => (a === 'droite' ? AlignmentType.RIGHT : a === 'centre' ? AlignmentType.CENTER : AlignmentType.LEFT);
const bordure = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
const bordureBlanche = { style: BorderStyle.SINGLE, size: 12, color: 'FFFFFF' };

function cellule(texte: string, largeur: number, opts: { gras?: boolean; fond?: string; couleur?: string; align?: string }) {
  return new TableCell({
    width: { size: largeur, type: WidthType.DXA },
    shading: opts.fond ? { type: ShadingType.CLEAR, fill: opts.fond, color: 'auto' } : undefined,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    borders: { top: bordure, bottom: bordure, left: bordure, right: bordure },
    children: [
      new Paragraph({
        alignment: alignement(opts.align),
        children: [new TextRun({ text: texte ?? '', bold: opts.gras, color: opts.couleur, size: 16 })],
      }),
    ],
  });
}

function tableau(t: TableauRapport): Table {
  const somme = t.colonnes.reduce((s, c) => s + (c.poids ?? 1), 0);
  const larg = t.colonnes.map((c) => Math.floor(((c.poids ?? 1) / somme) * LARGEUR_UTILE));
  const enTete = new TableRow({
    tableHeader: true,
    children: t.colonnes.map((c, i) => cellule(c.titre, larg[i], { gras: true, fond: FOND_ENTETE, couleur: COULEUR, align: c.align })),
  });
  const lignes = t.lignes.map(
    (l, r) =>
      new TableRow({
        cantSplit: true,
        children: l.map((v, i) => cellule(v, larg[i], { fond: r % 2 ? FOND_ZEBRE : undefined, align: t.colonnes[i].align })),
      }),
  );
  const total = t.total
    ? [new TableRow({ children: t.total.map((v, i) => cellule(v, larg[i], { gras: true, fond: FOND_ENTETE, align: t.colonnes[i].align })) })]
    : [];
  return new Table({ width: { size: LARGEUR_UTILE, type: WidthType.DXA }, rows: [enTete, ...lignes, ...total] });
}

function section(s: SectionRapport): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 280, after: 120 },
      children: [new TextRun({ text: s.titre, bold: true, color: COULEUR, size: 24 })],
    }),
  ];
  if (s.indicateurs?.length) {
    const par = Math.min(4, s.indicateurs.length);
    const l = Math.floor(LARGEUR_UTILE / par);
    for (let i = 0; i < s.indicateurs.length; i += par) {
      const lot = s.indicateurs.slice(i, i + par);
      out.push(
        new Table({
          width: { size: LARGEUR_UTILE, type: WidthType.DXA },
          rows: [
            new TableRow({
              children: Array.from({ length: par }, (_, j) => {
                const k = lot[j];
                return new TableCell({
                  width: { size: l, type: WidthType.DXA },
                  shading: k ? { type: ShadingType.CLEAR, fill: FOND_ENTETE, color: 'auto' } : undefined,
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  borders: { top: bordureBlanche, bottom: bordureBlanche, left: bordureBlanche, right: bordureBlanche },
                  children: k
                    ? [
                        new Paragraph({ children: [new TextRun({ text: k.libelle, color: '6B7280', size: 16 })] }),
                        new Paragraph({ children: [new TextRun({ text: k.valeur, bold: true, color: COULEUR, size: 26 })] }),
                      ]
                    : [new Paragraph('')],
                });
              }),
            }),
          ],
        }),
        new Paragraph({ spacing: { after: 60 }, children: [] }),
      );
    }
  }
  if (s.tableau) {
    out.push(tableau(s.tableau));
    if (s.tableau.note) {
      out.push(new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: s.tableau.note, italics: true, color: '6B7280', size: 16 })] }));
    }
  }
  return out;
}

/** Génère le document Word (A4 paysage, tableaux à en-tête répété, pied de page numéroté) d'un rapport. */
export async function genererDocx(rapport: RapportDocument): Promise<Buffer> {
  const entete: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: rapport.titre, bold: true, color: COULEUR, size: 36 })] }),
    ...(rapport.sousTitre ? [new Paragraph({ children: [new TextRun({ text: rapport.sousTitre, color: '6B7280', size: 20 })] })] : []),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: `${rapport.organisation} — généré le ${rapport.genereLe}${rapport.genererPar ? ` par ${rapport.genererPar}` : ''}`,
          color: '6B7280',
          size: 18,
        }),
      ],
    }),
    ...(rapport.filtres.length
      ? [
          new Paragraph({ children: [new TextRun({ text: rapport.libelleCriteres ?? 'Critères du rapport', bold: true, size: 18 })] }),
          ...rapport.filtres.map((f) => new Paragraph({ children: [new TextRun({ text: `• ${f.libelle} : ${f.valeur}`, size: 18 })] })),
        ]
      : []),
  ];
  const gris = { color: '6B7280', size: 16 };
  const doc = new Document({
    title: rapport.titre,
    creator: rapport.organisation,
    sections: [
      {
        properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 700, bottom: 700, left: 700, right: 700 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `${rapport.titre} — page `, ...gris }),
                  new TextRun({ children: [PageNumber.CURRENT], ...gris }),
                  new TextRun({ text: ' / ', ...gris }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], ...gris }),
                ],
              }),
            ],
          }),
        },
        children: [...entete, ...rapport.sections.flatMap(section)],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
