import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogueImportService } from './catalogue-import.service';
import { CategoriesActeService } from '../reference/categories-acte.service';
import { categoriesActeServiceDeTest } from '../reference/categories-acte.testing';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'sa@plateforme.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

const superadmin = () => ({
  profil: { id: 'u1', organisationId: null },
  permissions: { roleChain: ['SUPERADMIN_PRINCIPAL'] },
});
const informatique = () => ({
  profil: { id: 'u2', organisationId: 'org-1' },
  permissions: { roleChain: ['ASSUREUR_INFORMATIQUE'] },
});

async function fabriquerClasseurActes(lignes: (string | undefined)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const feuille = workbook.addWorksheet('Actes');
  feuille.addRow(['code', 'libelle', 'categorie']);
  for (const ligne of lignes) feuille.addRow(ligne);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function fabriquerClasseurMedicaments(lignes: (string | undefined)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const feuille = workbook.addWorksheet('Medicaments');
  feuille.addRow(['denomination_commune', 'nom_commercial', 'classe_therapeutique', 'prix_reference_xof', 'medicament_essentiel']);
  for (const ligne of lignes) feuille.addRow(ligne);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function fichier(buffer: Buffer, nom = 'catalogue.xlsx') {
  return {
    buffer,
    originalname: nom,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
  };
}

describe('CatalogueImportService', () => {
  let service: CatalogueImportService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      referentielNationalActe: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      referentielNationalMedicament: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      importCatalogueNational: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CategoriesActeService, useValue: categoriesActeServiceDeTest() },
        CatalogueImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();

    service = moduleRef.get(CatalogueImportService);
  });

  describe('importerCatalogueExcel — ACTES', () => {
    it('refuse un rôle non habilité (ASSUREUR_INFORMATIQUE)', async () => {
      identity.getMe.mockResolvedValue(informatique());
      const buf = await fabriquerClasseurActes([['CI-CONS-GEN', 'Consultation générale', 'CONSULTATION']]);
      await expect(
        service.importerCatalogueExcel(USER, 'ACTES', fichier(buf)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('crée l’import avec des lignes valides (nouveaux codes)', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.referentielNationalActe.findMany.mockResolvedValue([]);
      prisma.importCatalogueNational.create.mockResolvedValue({ id: 'imp-1', type: 'ACTES', statut: 'EN_ATTENTE_VALIDATION' });
      const buf = await fabriquerClasseurActes([
        ['CI-CONS-GEN', 'Consultation générale', 'CONSULTATION'],
        ['CI-CONS-SPE', 'Consultation spécialisée', 'CONSULTATION'],
      ]);

      const res = await service.importerCatalogueExcel(USER, 'ACTES', fichier(buf));

      expect(prisma.importCatalogueNational.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'ACTES',
            nbLignesValides: 2,
            nbLignesErreur: 0,
          }),
        }),
      );
      const lignes = prisma.importCatalogueNational.create.mock.calls[0][0].data.lignesValides;
      expect(lignes.every((l: any) => l.estMiseAJour === false)).toBe(true);
      expect(res.id).toBe('imp-1');
    });

    it('un code déjà existant dans le catalogue national est signalé comme mise à jour, pas une erreur', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.referentielNationalActe.findMany.mockResolvedValue([{ id: 'acte-existant', code: 'CI-CONS-GEN' }]);
      prisma.importCatalogueNational.create.mockResolvedValue({ id: 'imp-2' });
      const buf = await fabriquerClasseurActes([['CI-CONS-GEN', 'Consultation générale (MAJ)', 'CONSULTATION']]);

      await service.importerCatalogueExcel(USER, 'ACTES', fichier(buf));

      const lignes = prisma.importCatalogueNational.create.mock.calls[0][0].data.lignesValides;
      expect(lignes).toHaveLength(1);
      expect(lignes[0]).toMatchObject({ estMiseAJour: true, idExistant: 'acte-existant' });
      expect(prisma.importCatalogueNational.create.mock.calls[0][0].data.nbLignesErreur).toBe(0);
    });

    it('code en doublon DANS le fichier → erreur pour les deux lignes', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.importCatalogueNational.create.mockResolvedValue({ id: 'imp-3' });
      const buf = await fabriquerClasseurActes([
        ['CI-DUP', 'Premier libellé', 'CONSULTATION'],
        ['CI-DUP', 'Second libellé', 'CONSULTATION'],
      ]);

      await service.importerCatalogueExcel(USER, 'ACTES', fichier(buf));

      const data = prisma.importCatalogueNational.create.mock.calls[0][0].data;
      expect(data.nbLignesValides).toBe(0);
      expect(data.nbLignesErreur).toBe(2);
    });

    it('code manquant → ligne en erreur', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.importCatalogueNational.create.mockResolvedValue({ id: 'imp-4' });
      const buf = await fabriquerClasseurActes([[undefined, 'Libellé sans code', 'CONSULTATION']]);

      await service.importerCatalogueExcel(USER, 'ACTES', fichier(buf));

      const data = prisma.importCatalogueNational.create.mock.calls[0][0].data;
      expect(data.nbLignesErreur).toBe(1);
      expect(data.erreursDetail[0].erreurs).toContain('code manquant');
    });

    it('colonnes manquantes → 400', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      const workbook = new ExcelJS.Workbook();
      const feuille = workbook.addWorksheet('Actes');
      feuille.addRow(['code']);
      feuille.addRow(['CI-X']);
      const buf = Buffer.from(await workbook.xlsx.writeBuffer());
      await expect(
        service.importerCatalogueExcel(USER, 'ACTES', fichier(buf)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('fichier non-xlsx → 400', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      const f = { buffer: Buffer.from('pas un excel'), originalname: 'actes.csv', mimetype: 'text/csv', size: 20 };
      await expect(service.importerCatalogueExcel(USER, 'ACTES', f)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('fichier vide (aucune ligne de données) → 400', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      const buf = await fabriquerClasseurActes([]);
      await expect(
        service.importerCatalogueExcel(USER, 'ACTES', fichier(buf)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('importerCatalogueExcel — MEDICAMENTS', () => {
    it('crée l’import avec des lignes valides', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.referentielNationalMedicament.findMany.mockResolvedValue([]);
      prisma.importCatalogueNational.create.mockResolvedValue({ id: 'imp-5' });
      const buf = await fabriquerClasseurMedicaments([
        ['Paracétamol', 'Doliprane', 'Analgésique', '500', 'OUI'],
      ]);

      await service.importerCatalogueExcel(USER, 'MEDICAMENTS', fichier(buf));

      const data = prisma.importCatalogueNational.create.mock.calls[0][0].data;
      expect(data.nbLignesValides).toBe(1);
      expect(data.lignesValides[0]).toMatchObject({
        denominationCommune: 'Paracétamol',
        prixReferenceXof: '500.00',
        medicamentEssentiel: true,
        estMiseAJour: false,
      });
    });

    it('DCI déjà existante (insensible à la casse) → mise à jour, pas une erreur', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.referentielNationalMedicament.findMany.mockResolvedValue([
        { id: 'med-existant', denominationCommune: 'paracétamol' },
      ]);
      prisma.importCatalogueNational.create.mockResolvedValue({ id: 'imp-6' });
      const buf = await fabriquerClasseurMedicaments([['Paracétamol', 'Doliprane', 'Analgésique', '500', 'NON']]);

      await service.importerCatalogueExcel(USER, 'MEDICAMENTS', fichier(buf));

      const data = prisma.importCatalogueNational.create.mock.calls[0][0].data;
      expect(data.nbLignesErreur).toBe(0);
      expect(data.lignesValides[0]).toMatchObject({ estMiseAJour: true, idExistant: 'med-existant' });
    });

    it('prix de référence invalide → erreur', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.importCatalogueNational.create.mockResolvedValue({ id: 'imp-7' });
      const buf = await fabriquerClasseurMedicaments([['Ibuprofène', '', '', 'pas-un-prix', 'NON']]);

      await service.importerCatalogueExcel(USER, 'MEDICAMENTS', fichier(buf));

      const data = prisma.importCatalogueNational.create.mock.calls[0][0].data;
      expect(data.nbLignesErreur).toBe(1);
      expect(data.erreursDetail[0].erreurs[0]).toMatch(/prix de référence invalide/);
    });

    it('dénomination commune manquante → erreur', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.importCatalogueNational.create.mockResolvedValue({ id: 'imp-8' });
      const buf = await fabriquerClasseurMedicaments([[undefined, 'Sans DCI', '', '', '']]);

      await service.importerCatalogueExcel(USER, 'MEDICAMENTS', fichier(buf));

      const data = prisma.importCatalogueNational.create.mock.calls[0][0].data;
      expect(data.nbLignesErreur).toBe(1);
    });
  });

  describe('listerImportsCatalogue', () => {
    it('refuse un rôle non habilité', async () => {
      identity.getMe.mockResolvedValue(informatique());
      await expect(service.listerImportsCatalogue(USER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('liste les imports pour SUPERADMIN_PRINCIPAL', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.importCatalogueNational.findMany.mockResolvedValue([{ id: 'imp-1' }]);
      const res = await service.listerImportsCatalogue(USER);
      expect(res).toHaveLength(1);
    });
  });

  describe('validerImportCatalogue', () => {
    it('refuse un rôle non habilité', async () => {
      identity.getMe.mockResolvedValue(informatique());
      await expect(service.validerImportCatalogue(USER, 'imp-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('import introuvable → 404', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.importCatalogueNational.findFirst.mockResolvedValue(null);
      await expect(service.validerImportCatalogue(USER, 'imp-x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('import déjà validé → 409', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.importCatalogueNational.findFirst.mockResolvedValue({ id: 'imp-1', statut: 'VALIDE', lignesValides: [] });
      await expect(service.validerImportCatalogue(USER, 'imp-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('aucune ligne valide → 409', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.importCatalogueNational.findFirst.mockResolvedValue({
        id: 'imp-1',
        statut: 'EN_ATTENTE_VALIDATION',
        type: 'ACTES',
        lignesValides: [],
      });
      await expect(service.validerImportCatalogue(USER, 'imp-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('ACTES : crée les nouvelles entrées au statut PROPOSE (jamais HOMOLOGUE)', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.importCatalogueNational.findFirst.mockResolvedValue({
        id: 'imp-1',
        statut: 'EN_ATTENTE_VALIDATION',
        type: 'ACTES',
        lignesValides: [
          { code: 'CI-NEW', libelle: 'Nouvel acte', categorie: 'CONSULTATION', estMiseAJour: false, idExistant: null },
        ],
      });
      prisma.referentielNationalActe.create.mockResolvedValue({ id: 'acte-nouveau' });
      prisma.importCatalogueNational.update.mockResolvedValue({ id: 'imp-1', statut: 'VALIDE' });

      const res = await service.validerImportCatalogue(USER, 'imp-1');

      expect(prisma.referentielNationalActe.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code: 'CI-NEW', statut: 'PROPOSE' }),
        }),
      );
      expect(prisma.referentielNationalActe.update).not.toHaveBeenCalled();
      expect(res.nbCrees).toBe(1);
      expect(res.nbMisAJour).toBe(0);
    });

    it('ACTES : met à jour un doublon SANS toucher au statut d’homologation existant', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.importCatalogueNational.findFirst.mockResolvedValue({
        id: 'imp-2',
        statut: 'EN_ATTENTE_VALIDATION',
        type: 'ACTES',
        lignesValides: [
          { code: 'CI-EXIST', libelle: 'Libellé mis à jour', categorie: 'IMAGERIE', estMiseAJour: true, idExistant: 'acte-existant' },
        ],
      });
      prisma.referentielNationalActe.update.mockResolvedValue({ id: 'acte-existant' });
      prisma.importCatalogueNational.update.mockResolvedValue({ id: 'imp-2', statut: 'VALIDE' });

      const res = await service.validerImportCatalogue(USER, 'imp-2');

      expect(prisma.referentielNationalActe.update).toHaveBeenCalledWith({
        where: { id: 'acte-existant' },
        data: { libelle: 'Libellé mis à jour', categorie: 'IMAGERIE' },
      });
      expect(prisma.referentielNationalActe.create).not.toHaveBeenCalled();
      expect(res.nbCrees).toBe(0);
      expect(res.nbMisAJour).toBe(1);
    });

    it('MEDICAMENTS : crée les nouvelles entrées au statut PROPOSE (jamais HOMOLOGUE)', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.importCatalogueNational.findFirst.mockResolvedValue({
        id: 'imp-3',
        statut: 'EN_ATTENTE_VALIDATION',
        type: 'MEDICAMENTS',
        lignesValides: [
          {
            denominationCommune: 'Amoxicilline',
            nomCommercial: null,
            classeTherapeutique: 'Antibiotique',
            prixReferenceXof: '1500.00',
            medicamentEssentiel: true,
            estMiseAJour: false,
            idExistant: null,
          },
        ],
      });
      prisma.referentielNationalMedicament.create.mockResolvedValue({ id: 'med-nouveau' });
      prisma.importCatalogueNational.update.mockResolvedValue({ id: 'imp-3', statut: 'VALIDE' });

      const res = await service.validerImportCatalogue(USER, 'imp-3');

      expect(prisma.referentielNationalMedicament.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ denominationCommune: 'Amoxicilline', statutHomologation: 'PROPOSE' }),
        }),
      );
      expect(res.nbCrees).toBe(1);
    });

    it('MEDICAMENTS : met à jour un doublon SANS toucher au statut d’homologation existant', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.importCatalogueNational.findFirst.mockResolvedValue({
        id: 'imp-4',
        statut: 'EN_ATTENTE_VALIDATION',
        type: 'MEDICAMENTS',
        lignesValides: [
          {
            denominationCommune: 'Paracétamol',
            nomCommercial: 'Doliprane',
            classeTherapeutique: 'Analgésique',
            prixReferenceXof: '600.00',
            medicamentEssentiel: true,
            estMiseAJour: true,
            idExistant: 'med-existant',
          },
        ],
      });
      prisma.referentielNationalMedicament.update.mockResolvedValue({ id: 'med-existant' });
      prisma.importCatalogueNational.update.mockResolvedValue({ id: 'imp-4', statut: 'VALIDE' });

      const res = await service.validerImportCatalogue(USER, 'imp-4');

      expect(prisma.referentielNationalMedicament.update).toHaveBeenCalledWith({
        where: { id: 'med-existant' },
        data: {
          nomCommercial: 'Doliprane',
          classeTherapeutique: 'Analgésique',
          prixReferenceXof: '600.00',
          medicamentEssentiel: true,
        },
      });
      expect(prisma.referentielNationalMedicament.create).not.toHaveBeenCalled();
      expect(res.nbMisAJour).toBe(1);
    });

    it('marque l’import VALIDE avec valideParId et dateValidation', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.importCatalogueNational.findFirst.mockResolvedValue({
        id: 'imp-5',
        statut: 'EN_ATTENTE_VALIDATION',
        type: 'ACTES',
        lignesValides: [{ code: 'CI-NEW', libelle: 'X', categorie: null, estMiseAJour: false, idExistant: null }],
      });
      prisma.referentielNationalActe.create.mockResolvedValue({ id: 'acte-1' });
      prisma.importCatalogueNational.update.mockResolvedValue({ id: 'imp-5', statut: 'VALIDE' });

      await service.validerImportCatalogue(USER, 'imp-5');

      expect(prisma.importCatalogueNational.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'imp-5' },
          data: expect.objectContaining({ statut: 'VALIDE', valideParId: 'u1' }),
        }),
      );
    });

    it('log_audit() échoue → la méthode rejette (PROMPT 4 : jamais avalé)', async () => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.importCatalogueNational.findFirst.mockResolvedValue({
        id: 'imp-6',
        statut: 'EN_ATTENTE_VALIDATION',
        type: 'ACTES',
        lignesValides: [{ code: 'CI-NEW', libelle: 'X', categorie: null, estMiseAJour: false, idExistant: null }],
      });
      prisma.referentielNationalActe.create.mockResolvedValue({ id: 'acte-1' });
      prisma.$executeRaw.mockRejectedValueOnce(new Error('log_audit indisponible'));

      await expect(service.validerImportCatalogue(USER, 'imp-6')).rejects.toThrow('log_audit indisponible');
    });
  });
});
