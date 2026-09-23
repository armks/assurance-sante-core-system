import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemberCarteService } from './carte.service';
import { ImportAdherentsService } from './import-adherents.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'info@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

const identite = (roleChain: string[]) => ({
  profil: { id: 'u1', organisationId: 'org-1', societeId: null, entite: 'ASSUREUR', adherentId: null },
  permissions: roleChain.length ? { roleChain } : null,
});

async function fabriquerClasseur(lignes: (string | undefined)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const feuille = workbook.addWorksheet('Adherents');
  feuille.addRow(['nom', 'prenom', 'telephone', 'email', 'date de naissance']);
  for (const ligne of lignes) feuille.addRow(ligne);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function fichier(buffer: Buffer, nom = 'adherents.xlsx') {
  return {
    buffer,
    originalname: nom,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
  };
}

describe('ImportAdherentsService', () => {
  let service: ImportAdherentsService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let cartes: { genererCarteAdherent: jest.Mock };

  beforeEach(async () => {
    prisma = {
      souscripteur: { findFirst: jest.fn() },
      police: { findFirst: jest.fn() },
      adherent: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      importAdherents: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };
    cartes = { genererCarteAdherent: jest.fn().mockResolvedValue({ url: 'https://signed' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ImportAdherentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: MemberCarteService, useValue: cartes },
      ],
    }).compile();

    service = moduleRef.get(ImportAdherentsService);
  });

  describe('importerAdherentsExcel', () => {
    it('refuse un rôle non habilité (exploitation)', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      const buf = await fabriquerClasseur([['Yao', 'Awa', '0700000001', 'awa@test.ci', '1990-05-14']]);
      await expect(
        service.importerAdherentsExcel(USER, 'sous-1', fichier(buf)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('autorise ASSUREUR_COMPTABLE', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
      prisma.souscripteur.findFirst.mockResolvedValue({ id: 'sous-1' });
      prisma.importAdherents.create.mockResolvedValue({ id: 'imp-1', statut: 'EN_ATTENTE_VALIDATION' });
      const buf = await fabriquerClasseur([['Yao', 'Awa', '0700000001', 'awa@test.ci', '1990-05-14']]);

      const res = await service.importerAdherentsExcel(USER, 'sous-1', fichier(buf));
      expect(res.id).toBe('imp-1');
    });

    it('souscripteur introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.souscripteur.findFirst.mockResolvedValue(null);
      const buf = await fabriquerClasseur([['Yao', 'Awa', '0700000001', 'awa@test.ci', '1990-05-14']]);
      await expect(
        service.importerAdherentsExcel(USER, 'sous-x', fichier(buf)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('fichier non-xlsx → 400', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.souscripteur.findFirst.mockResolvedValue({ id: 'sous-1' });
      const f = { buffer: Buffer.from('pas un excel'), originalname: 'adherents.csv', mimetype: 'text/csv', size: 20 };
      await expect(service.importerAdherentsExcel(USER, 'sous-1', f)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('colonnes manquantes → 400', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.souscripteur.findFirst.mockResolvedValue({ id: 'sous-1' });
      const workbook = new ExcelJS.Workbook();
      const feuille = workbook.addWorksheet('Adherents');
      feuille.addRow(['nom', 'prenom']); // téléphone/email/date de naissance manquants
      feuille.addRow(['Yao', 'Awa']);
      const buf = Buffer.from(await workbook.xlsx.writeBuffer());
      await expect(
        service.importerAdherentsExcel(USER, 'sous-1', fichier(buf)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('fichier sans aucune ligne de données → 400', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.souscripteur.findFirst.mockResolvedValue({ id: 'sous-1' });
      const buf = await fabriquerClasseur([]);
      await expect(
        service.importerAdherentsExcel(USER, 'sous-1', fichier(buf)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('détecte : email en doublon (dans le fichier), champ manquant, téléphone invalide — sans bloquer les lignes valides', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.souscripteur.findFirst.mockResolvedValue({ id: 'sous-1' });
      let cree: any = null;
      prisma.importAdherents.create.mockImplementation(({ data }: any) => {
        cree = data;
        return Promise.resolve({ id: 'imp-1', ...data });
      });

      const buf = await fabriquerClasseur([
        ['Yao', 'Awa', '0700000001', 'awa@test.ci', '1990-05-14'], // valide
        ['Konan', 'Yves', '0700000002', 'awa@test.ci', '1985-01-01'], // email doublon avec la ligne 1
        ['', 'SansNom', '0700000003', 'sansnom@test.ci', '1992-02-02'], // nom manquant
        ['Traore', 'Fatou', 'abcabc', 'fatou@test.ci', '1988-03-03'], // téléphone invalide
      ]);

      const res = await service.importerAdherentsExcel(USER, 'sous-1', fichier(buf));

      // Les 2 lignes partageant le même email sont TOUTES DEUX en erreur (on
      // ne peut pas deviner laquelle des deux est la bonne) — seules les 2
      // autres lignes sont d'authentiques erreurs indépendantes.
      expect(res.nbLignesValides).toBe(0);
      expect(res.nbLignesErreur).toBe(4);
      const erreurs = cree.erreursDetail as { ligne: number; erreurs: string[] }[];
      expect(erreurs.find((e) => e.ligne === 2)?.erreurs.some((m: string) => m.includes('doublon'))).toBe(true);
      expect(erreurs.find((e) => e.ligne === 3)?.erreurs.some((m: string) => m.includes('doublon'))).toBe(true);
      expect(erreurs.find((e) => e.ligne === 4)?.erreurs.some((m: string) => m.includes('nom manquant'))).toBe(true);
      expect(erreurs.find((e) => e.ligne === 5)?.erreurs.some((m: string) => m.includes('téléphone invalide'))).toBe(true);
    });

    it('email en doublon dans le fichier : la ligne SEULE (sans doublon) reste valide', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.souscripteur.findFirst.mockResolvedValue({ id: 'sous-1' });
      let cree: any = null;
      prisma.importAdherents.create.mockImplementation(({ data }: any) => {
        cree = data;
        return Promise.resolve({ id: 'imp-1', ...data });
      });

      const buf = await fabriquerClasseur([
        ['Yao', 'Awa', '0700000001', 'awa@test.ci', '1990-05-14'],
        ['Konan', 'Yves', '0700000002', 'awa@test.ci', '1985-01-01'], // doublon avec la ligne précédente
        ['Traore', 'Fatou', '0700000003', 'fatou@test.ci', '1988-03-03'], // indépendante, valide
      ]);

      const res = await service.importerAdherentsExcel(USER, 'sous-1', fichier(buf));

      expect(res.nbLignesValides).toBe(1);
      expect(res.nbLignesErreur).toBe(2);
      expect(cree.lignesValides).toEqual([expect.objectContaining({ email: 'fatou@test.ci' })]);
    });

    it('email déjà utilisé par un adhérent existant → erreur', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.souscripteur.findFirst.mockResolvedValue({ id: 'sous-1' });
      prisma.adherent.findMany.mockResolvedValue([{ email: 'existe@test.ci' }]);
      let cree: any = null;
      prisma.importAdherents.create.mockImplementation(({ data }: any) => {
        cree = data;
        return Promise.resolve({ id: 'imp-1', ...data });
      });

      const buf = await fabriquerClasseur([['Yao', 'Awa', '0700000001', 'existe@test.ci', '1990-05-14']]);
      const res = await service.importerAdherentsExcel(USER, 'sous-1', fichier(buf));

      expect(res.nbLignesValides).toBe(0);
      expect(res.nbLignesErreur).toBe(1);
      expect(cree.erreursDetail[0].erreurs.some((m: string) => m.includes('déjà utilisé'))).toBe(true);
    });
  });

  describe('validerImportAdherents', () => {
    const IMPORT_EN_ATTENTE = {
      id: 'imp-1',
      organisationId: 'org-1',
      souscripteurId: 'sous-1',
      statut: 'EN_ATTENTE_VALIDATION',
      lignesValides: [
        { nom: 'Yao', prenom: 'Awa', telephone: '0700000001', email: 'awa@test.ci', dateNaissance: '1990-05-14' },
        { nom: 'Konan', prenom: 'Yves', telephone: '0700000002', email: 'yves@test.ci', dateNaissance: '1985-01-01' },
      ],
    };

    it('refuse ASSUREUR_COMPTABLE (peut importer, pas valider)', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
      await expect(service.validerImportAdherents(USER, 'imp-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.adherent.create).not.toHaveBeenCalled();
    });

    it('import introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.importAdherents.findFirst.mockResolvedValue(null);
      await expect(service.validerImportAdherents(USER, 'imp-x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('déjà validé → 409', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      prisma.importAdherents.findFirst.mockResolvedValue({ ...IMPORT_EN_ATTENTE, statut: 'VALIDE' });
      await expect(service.validerImportAdherents(USER, 'imp-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('aucune police ACTIVE → 409', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      prisma.importAdherents.findFirst.mockResolvedValue(IMPORT_EN_ATTENTE);
      prisma.police.findFirst.mockResolvedValue(null);
      await expect(service.validerImportAdherents(USER, 'imp-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.adherent.create).not.toHaveBeenCalled();
    });

    it('crée un Adherent par ligne valide et génère sa carte, puis marque VALIDE', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.importAdherents.findFirst.mockResolvedValue(IMPORT_EN_ATTENTE);
      prisma.police.findFirst.mockResolvedValue({ id: 'po-1' });
      prisma.adherent.create
        .mockResolvedValueOnce({ id: 'adh-1', numeroAdherent: 'ADH-2026-000001' })
        .mockResolvedValueOnce({ id: 'adh-2', numeroAdherent: 'ADH-2026-000002' });
      prisma.importAdherents.update.mockResolvedValue({ ...IMPORT_EN_ATTENTE, statut: 'VALIDE' });

      const res = await service.validerImportAdherents(USER, 'imp-1');

      expect(prisma.adherent.create).toHaveBeenCalledTimes(2);
      expect(prisma.adherent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ souscripteurId: 'sous-1', policeId: 'po-1', email: 'awa@test.ci', telephone: '0700000001' }),
        }),
      );
      expect(cartes.genererCarteAdherent).toHaveBeenCalledTimes(2);
      expect(cartes.genererCarteAdherent).toHaveBeenCalledWith(USER, 'adh-1');
      expect(cartes.genererCarteAdherent).toHaveBeenCalledWith(USER, 'adh-2');
      expect(prisma.importAdherents.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'imp-1' },
          data: expect.objectContaining({ statut: 'VALIDE', valideParId: 'u1' }),
        }),
      );
      expect(res.nbAdherentsCrees).toBe(2);
    });

    it('un échec de génération de carte ne bloque ni les autres lignes ni la validation', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      prisma.importAdherents.findFirst.mockResolvedValue(IMPORT_EN_ATTENTE);
      prisma.police.findFirst.mockResolvedValue({ id: 'po-1' });
      prisma.adherent.create
        .mockResolvedValueOnce({ id: 'adh-1', numeroAdherent: 'ADH-2026-000001' })
        .mockResolvedValueOnce({ id: 'adh-2', numeroAdherent: 'ADH-2026-000002' });
      cartes.genererCarteAdherent
        .mockRejectedValueOnce(new Error('Storage indisponible'))
        .mockResolvedValueOnce({ url: 'https://signed' });
      prisma.importAdherents.update.mockResolvedValue({ ...IMPORT_EN_ATTENTE, statut: 'VALIDE' });

      const res = await service.validerImportAdherents(USER, 'imp-1');

      expect(res.nbAdherentsCrees).toBe(2);
      expect(res.echecsCarte).toEqual(['adh-1']);
      expect(prisma.importAdherents.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ statut: 'VALIDE' }) }),
      );
    });
  });

  describe('listerImportsAdherents', () => {
    it('refuse un rôle sans rapport', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_MEDECIN_CONSEIL']));
      await expect(service.listerImportsAdherents(USER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('autorise ASSUREUR_COMPTABLE (importeur) et ASSUREUR_EXPLOITATION (validateur)', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
      await expect(service.listerImportsAdherents(USER)).resolves.toEqual([]);

      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      await expect(service.listerImportsAdherents(USER)).resolves.toEqual([]);
    });
  });
});
