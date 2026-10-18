import { genererDocx } from './docx';
import { genererPdf } from './pdf';
import { dateFr, entier, francs, pourcent, type RapportDocument } from './rapport-document';

const rapport = (lignes: number): RapportDocument => ({
  titre: 'Rapport d’essai',
  sousTitre: 'Contrôle des exports',
  organisation: 'Assureur Test',
  filtres: [{ libelle: 'Période', valeur: '01/01/2026 au 31/01/2026' }],
  genereLe: '17/10/2026',
  genererPar: 'tests',
  sections: [
    { titre: 'Synthèse', indicateurs: [{ libelle: 'Dossiers', valeur: '12' }, { libelle: 'Coût', valeur: francs(1234567) }] },
    {
      titre: 'Tableau',
      tableau: {
        colonnes: [{ titre: 'Nom', poids: 3 }, { titre: 'Montant', align: 'droite' }],
        lignes: Array.from({ length: lignes }, (_, i) => [`Ligne ${i} — accentuée é è à`, francs(i * 1000)]),
        total: ['Total', francs(999)],
        note: 'Note de bas de tableau.',
      },
    },
  ],
});

describe('exports PDF et Word', () => {
  it('PDF : signature valide, plusieurs pages quand le tableau est long', async () => {
    const court = await genererPdf(rapport(3));
    const long = await genererPdf(rapport(200));
    expect(court.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages(court)).toBe(1);
    expect(pages(long)).toBeGreaterThan(3);
  });

  it('Word : archive OOXML contenant le titre, les critères et les lignes', async () => {
    const doc = await genererDocx(rapport(5));
    expect(doc.subarray(0, 2).toString()).toBe('PK');
    const { default: JSZip } = await import('jszip');
    const xml = await (await JSZip.loadAsync(doc)).file('word/document.xml')!.async('string');
    expect(xml).toContain('Rapport d’essai');
    expect(xml).toContain('Période : 01/01/2026 au 31/01/2026');
    expect(xml).toContain('Ligne 4');
    expect(xml).toContain('Note de bas de tableau.');
  });

  it('formats : espaces ordinaires, pourcentage et date françaises', () => {
    expect(entier(1234567)).toBe('1 234 567');
    expect(francs(85400)).toBe('85 400 F');
    expect(pourcent(12.34)).toBe('12,3 %');
    expect(dateFr('2026-07-04T10:00:00Z')).toBe('04/07/2026');
    expect(dateFr(null)).toBe('—');
  });
});
