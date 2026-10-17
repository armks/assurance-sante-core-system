import {
  chiffrerCode,
  dechiffrerCode,
  empreinteCode,
  estExpire,
  protegerCodes,
  secretCodesConfigure,
} from './codes-secrets';

describe('codes-secrets', () => {
  const avant = process.env.CODES_SECRET_MAITRE;
  beforeAll(() => {
    process.env.CODES_SECRET_MAITRE = 'x'.repeat(40);
  });
  afterAll(() => {
    process.env.CODES_SECRET_MAITRE = avant;
  });

  it('configure : secret présent', () => {
    expect(secretCodesConfigure()).toBe(true);
  });

  it('empreinte déterministe, insensible à la casse et aux espaces, irréversible (64 hex)', () => {
    expect(empreinteCode(' ab12cd ')).toBe(empreinteCode('AB12CD'));
    expect(empreinteCode('AB12CD')).toMatch(/^[A-F0-9]{64}$/);
    expect(empreinteCode('AB12CD')).not.toBe(empreinteCode('AB12CE'));
    expect(empreinteCode('AB12CD')).not.toContain('AB12CD');
  });

  it('chiffrement : aller-retour, IV aléatoire, altération détectée', () => {
    const a = chiffrerCode('AB12CD');
    const b = chiffrerCode('AB12CD');
    expect(a).not.toBe(b);
    expect(a).not.toContain('AB12CD');
    expect(dechiffrerCode(a)).toBe('AB12CD');
    const [v, iv, tag, texte] = a.split('.');
    const altere = [v, iv, tag, Buffer.from('ZZZZZZ').toString('base64url')].join('.');
    expect(texte).toBeDefined();
    expect(() => dechiffrerCode(altere)).toThrow();
    expect(() => dechiffrerCode('n-importe-quoi')).toThrow();
  });

  it('estExpire', () => {
    expect(estExpire(null)).toBe(false);
    expect(estExpire(new Date(Date.now() - 1000))).toBe(true);
    expect(estExpire(new Date(Date.now() + 60_000))).toBe(false);
  });

  describe('protegerCodes (extension Prisma)', () => {
    it('écriture : empreinte + chiffré, jamais le code en clair', async () => {
      let recu: any;
      await protegerCodes('CodeConsultation', { data: { code: 'ab12cd', statut: 'EMIS' } }, async (a) => {
        recu = a;
        return {};
      });
      expect(recu.data.code).toBe(empreinteCode('AB12CD'));
      expect(dechiffrerCode(recu.data.codeChiffre)).toBe('AB12CD');
      expect(JSON.stringify(recu)).not.toContain('"AB12CD"');
    });

    it('recherche : where traduit en empreinte (equals, in, AND/OR/NOT)', async () => {
      let recu: any;
      await protegerCodes('FactureDossier', { where: { OR: [{ codeFacturation: 'ab12cd' }, { codeFacturation: { in: ['zz99yy'] } }], NOT: { codeFacturation: { equals: 'qq11ww' } } } }, async (a) => {
        recu = a;
        return null;
      });
      expect(recu.where.OR[0].codeFacturation).toBe(empreinteCode('AB12CD'));
      expect(recu.where.OR[1].codeFacturation.in[0]).toBe(empreinteCode('ZZ99YY'));
      expect(recu.where.NOT.codeFacturation.equals).toBe(empreinteCode('QQ11WW'));
    });

    it('lecture : code restitué en clair, champ chiffré retiré, relations imbriquées comprises', async () => {
      const chiffre = chiffrerCode('AB12CD');
      const res = (await protegerCodes('TicketSoins', { include: { factures: true } }, async () => ({
        id: 1,
        code: 'TICKET',
        factures: [{ id: 2, codeFacturation: empreinteCode('AB12CD'), codeFacturationChiffre: chiffre }],
      }))) as any;
      expect(res.factures[0].codeFacturation).toBe('AB12CD');
      expect(res.factures[0]).not.toHaveProperty('codeFacturationChiffre');
      expect(res.code).toBe('TICKET');
    });

    it('select du code : la version chiffrée est ajoutée à la requête', async () => {
      let recu: any;
      await protegerCodes('DispensationPharmacie', { select: { id: true, codeConfirmation: true } }, async (a) => {
        recu = a;
        return null;
      });
      expect(recu.select.codeConfirmationChiffre).toBe(true);
    });

    it('modèle non concerné sans relation : passage direct', async () => {
      const args = { where: { code: 'abc' } };
      let recu: any;
      await protegerCodes('Pharmacie', args, async (a) => {
        recu = a;
        return [];
      });
      expect(recu.where.code).toBe('abc');
    });
  });
});
