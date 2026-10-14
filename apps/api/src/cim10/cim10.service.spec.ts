import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Cim10Service, FORMAT_CODE_CIM10 } from './cim10.service';

function service(roleChain: string[], maladie: unknown = null) {
  const prisma = {
    maladieCim10: { findUnique: jest.fn().mockResolvedValue(maladie) },
  };
  const identity = { getMe: jest.fn().mockResolvedValue({ profil: { id: 'u1' }, permissions: { roleChain } }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Cim10Service(prisma as any, identity as any);
}

describe('Cim10Service', () => {
  it('accepte les codes de catégorie et de sous-catégorie, refuse le reste', () => {
    for (const ok of ['A00', 'B50.9', 'S06.00', 'T36.1']) expect(FORMAT_CODE_CIM10.test(ok)).toBe(true);
    for (const ko of ['', 'A0', 'AB1', 'b50', 'A00.', 'A00.12345', 'A00-A09']) expect(FORMAT_CODE_CIM10.test(ko)).toBe(false);
  });

  it('verifierCode : normalise en majuscules un code actif', async () => {
    const s = service([], { code: 'B50.9', actif: true });
    await expect(s.verifierCode(' b50.9 ')).resolves.toBe('B50.9');
  });

  it('verifierCode : refuse un code inconnu ou désactivé', async () => {
    await expect(service([], null).verifierCode('Q00')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service([], { code: 'Q00', actif: false }).verifierCode('Q00')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('réserve la gestion au superadmin', async () => {
    await expect(service(['CENTRE_MEDICAL_MEDECIN']).creer({} as never, { code: 'A00', libelle: 'Choléra' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service(['CENTRE_MEDICAL_MEDECIN']).importer({} as never, undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("import : un fichier sans ligne valide est refusé avec le détail des erreurs", async () => {
    const s = service(['SUPERADMIN_PRINCIPAL']);
    const fichier = { buffer: Buffer.from('code;libelle\nXX;mauvais\nA00\n'), originalname: 'x.csv', size: 10 };
    await expect(s.importer({} as never, fichier)).rejects.toBeInstanceOf(BadRequestException);
  });
});
