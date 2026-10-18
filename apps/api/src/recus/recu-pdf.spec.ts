import { genererRecuPdf, type DonneesRecu, type TypeImprimante } from './recu-pdf';

const base = (imprimante: TypeImprimante, lignes = 2): DonneesRecu => ({
  imprimante,
  emetteur: { nom: 'Clinique Test', code: 'CT01', adresse: 'Cocody, Abidjan', telephone: '0102030405', identifiantFiscal: 'RCCM 123' },
  enTete: 'Agréé',
  pied: 'Merci',
  afficherDetail: true,
  numero: 'R-CT01-000001',
  emisLe: new Date('2026-10-18T08:00:00Z'),
  duplicata: 0,
  patient: { nom: 'Awa Koné', numeroCarte: 'CM-1', lien: 'TITULAIRE', societe: 'Société X' },
  reference: { libelle: 'Facture de soins', numero: 'F-TRT-1-01', dossier: 'TRT-1' },
  lignes: Array.from({ length: lignes }, (_, i) => ({ libelle: `Acte ${i + 1}`, quantite: 1, prixUnitaire: 5000, montantPatient: 1000 })),
  totaux: { total: 10000, assurance: 8000, patient: 2000 },
  paiement: { montant: 2000, date: new Date('2026-10-17T10:00:00Z'), mode: 'part du patient réglée' },
  caissier: 'caisse',
});

const mediaBox = (b: Buffer) => {
  const m = b.toString('latin1').match(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
};

describe('genererRecuPdf', () => {
  it.each([
    ['THERMIQUE_58', 58 * (72 / 25.4)],
    ['THERMIQUE_80', 80 * (72 / 25.4)],
  ] as const)('ticket %s : largeur du papier respectée', async (imprimante, largeur) => {
    const pdf = await genererRecuPdf(base(imprimante));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(mediaBox(pdf)[0]).toBeCloseTo(largeur, 0);
  });

  it('ticket thermique : la hauteur suit le contenu (plus de lignes, plus haut)', async () => {
    const court = mediaBox(await genererRecuPdf(base('THERMIQUE_80', 1)))[1];
    const long = mediaBox(await genererRecuPdf(base('THERMIQUE_80', 12)))[1];
    expect(long).toBeGreaterThan(court + 50);
  });

  it('A4 : page 595 x 842', async () => {
    const [w, h] = mediaBox(await genererRecuPdf(base('A4')));
    expect(w).toBeCloseTo(595.28, 0);
    expect(h).toBeCloseTo(841.89, 0);
  });

  it('duplicata et détail masqué : génère sans erreur', async () => {
    const pdf = await genererRecuPdf({ ...base('THERMIQUE_58'), duplicata: 2, afficherDetail: false, enTete: null, pied: null });
    expect(pdf.length).toBeGreaterThan(500);
  });
});
