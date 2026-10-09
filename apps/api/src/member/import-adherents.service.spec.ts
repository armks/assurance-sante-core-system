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
import { AdherentService } from './adherent.service';
import { MemberCarteService } from './carte.service';
import { ImportAdherentsService } from './import-adherents.service';
import { DependancesService } from '../dependances/dependances.service';
import { dependancesDeTest } from '../dependances/dependances.testing';

/** Garde des dépendances (ADR-007) : tout est possible par défaut. */
let dependances: ReturnType<typeof dependancesDeTest>;
beforeEach(() => {
  dependances = dependancesDeTest();
});

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'info@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

const identite = (roleChain: string[], societeId: string | null = null) => ({
  profil: {
    id: 'u1',
    organisationId: 'org-1',
    societeId,
    entite: societeId ? 'SOCIETE_AFFILIEE' : 'ASSUREUR',
    adherentId: null,
  },
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

async function fabriquerClasseurSortants(lignes: (string | undefined)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const feuille = workbook.addWorksheet('Sortants');
  feuille.addRow(['identifiant', 'motif', 'statut cible']);
  for (const ligne of lignes) feuille.addRow(ligne);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe('ImportAdherentsService', () => {
  let service: ImportAdherentsService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let cartes: { genererCarteAdherent: jest.Mock; genererCarteBeneficiaire: jest.Mock };
  let adherents: { proposerSortants: jest.Mock };

  beforeEach(async () => {
    prisma = {
      souscripteur: { findFirst: jest.fn() },
      police: { findFirst: jest.fn() },
      adherent: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      beneficiaire: { create: jest.fn() },
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
    cartes = {
      genererCarteAdherent: jest.fn().mockResolvedValue({ url: 'https://signed' }),
      genererCarteBeneficiaire: jest.fn().mockResolvedValue({ url: 'https://signed' }),
    };
    adherents = { proposerSortants: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ImportAdherentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: DependancesService, useValue: dependances },
        { provide: MemberCarteService, useValue: cartes },
        { provide: AdherentService, useValue: adherents },
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

    it('log_audit() échoue → la méthode rejette (PROMPT 4 : jamais avalé, la transaction Prisma se défait avec elle)', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
      prisma.souscripteur.findFirst.mockResolvedValue({ id: 'sous-1' });
      prisma.importAdherents.create.mockResolvedValue({ id: 'imp-1', statut: 'EN_ATTENTE_VALIDATION' });
      prisma.$executeRaw.mockRejectedValueOnce(new Error('log_audit indisponible'));
      const buf = await fabriquerClasseur([['Yao', 'Awa', '0700000001', 'awa@test.ci', '1990-05-14']]);

      await expect(
        service.importerAdherentsExcel(USER, 'sous-1', fichier(buf)),
      ).rejects.toThrow('log_audit indisponible');
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
        { type: 'ADHERENT', nom: 'Yao', prenom: 'Awa', telephone: '0700000001', email: 'awa@test.ci', dateNaissance: '1990-05-14' },
        { type: 'ADHERENT', nom: 'Konan', prenom: 'Yves', telephone: '0700000002', email: 'yves@test.ci', dateNaissance: '1985-01-01' },
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

    it('personnel ASSUREUR : exclut les BROUILLON (pas encore soumis par la société)', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      await service.listerImportsAdherents(USER);
      expect(prisma.importAdherents.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ statut: { not: 'BROUILLON' } }) }),
      );
    });

    it('société : scopée à SA PROPRE société, tout statut (y compris son brouillon)', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], 'sous-1'));
      await service.listerImportsAdherents(USER);
      expect(prisma.importAdherents.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ souscripteurId: 'sous-1' }) }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Propositions collaboratives société — SOCIETE_ASSUREE/ADMINISTRATION
  //  uniquement, jamais une autre société (ctx.societeId === souscripteurId).
  // ═══════════════════════════════════════════════════════════════════════
  describe('proposerAdherent', () => {
    const DTO = { nom: 'Yao', prenom: 'Awa', telephone: '0700000001', email: 'awa@test.ci', dateNaissance: '1990-05-14' };

    it('refuse un rôle non habilité (comptable société)', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_COMPTABLE'], 'sous-1'));
      await expect(service.proposerAdherent(USER, 'sous-1', DTO)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("refuse une AUTRE société que la sienne", async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], 'sous-1'));
      await expect(service.proposerAdherent(USER, 'sous-AUTRE', DTO)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ligne invalide (téléphone) → 400, aucun brouillon créé', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-1'));
      await expect(
        service.proposerAdherent(USER, 'sous-1', { ...DTO, telephone: 'abc' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.importAdherents.create).not.toHaveBeenCalled();
    });

    it('email déjà utilisé par un adhérent existant → 409', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-1'));
      prisma.adherent.findFirst.mockResolvedValue({ id: 'adh-existant' });
      await expect(service.proposerAdherent(USER, 'sous-1', DTO)).rejects.toBeInstanceOf(ConflictException);
    });

    it('crée le brouillon (inexistant) et y ajoute la ligne', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], 'sous-1'));
      prisma.importAdherents.findFirst.mockResolvedValue(null); // pas de brouillon existant
      prisma.importAdherents.create.mockResolvedValue({ id: 'imp-1', lignesValides: [] });
      prisma.importAdherents.update.mockResolvedValue({ id: 'imp-1', lignesValides: [{ type: 'ADHERENT', ...DTO }] });

      const res = await service.proposerAdherent(USER, 'sous-1', DTO);

      expect(prisma.importAdherents.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ souscripteurId: 'sous-1', statut: 'BROUILLON', fichierNom: null }) }),
      );
      expect(prisma.importAdherents.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'imp-1' },
          data: expect.objectContaining({
            lignesValides: [expect.objectContaining({ type: 'ADHERENT', nom: 'Yao', email: 'awa@test.ci' })],
            nbLignesTotal: 1,
            nbLignesValides: 1,
          }),
        }),
      );
      expect(res.id).toBe('imp-1');
    });

    it('réutilise le brouillon déjà ouvert plutôt que d’en créer un second', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-1'));
      prisma.importAdherents.findFirst.mockResolvedValue({
        id: 'imp-1',
        lignesValides: [{ type: 'ADHERENT', nom: 'Konan', prenom: 'Yves', telephone: '0700000002', email: 'yves@test.ci', dateNaissance: '1985-01-01' }],
      });
      prisma.importAdherents.update.mockResolvedValue({ id: 'imp-1' });

      await service.proposerAdherent(USER, 'sous-1', DTO);

      expect(prisma.importAdherents.create).not.toHaveBeenCalled();
      expect(prisma.importAdherents.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ nbLignesTotal: 2 }) }),
      );
    });

    it('email déjà proposé dans le brouillon en cours → 409', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-1'));
      prisma.importAdherents.findFirst.mockResolvedValue({
        id: 'imp-1',
        lignesValides: [{ type: 'ADHERENT', nom: 'Autre', prenom: 'Personne', telephone: '0700009999', email: DTO.email, dateNaissance: '1980-01-01' }],
      });
      await expect(service.proposerAdherent(USER, 'sous-1', DTO)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.importAdherents.update).not.toHaveBeenCalled();
    });
  });

  describe('proposerBeneficiaire', () => {
    const DTO = { adherentId: 'adh-1', lienParente: 'ENFANT', nom: 'Petit', prenom: 'Yao', dateNaissance: '2015-03-10', sexe: 'M' };

    it('refuse un rôle non habilité', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_RECEPTION'], 'sous-1'));
      await expect(service.proposerBeneficiaire(USER, 'sous-1', DTO)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("adhérent introuvable pour cette société → 404", async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-1'));
      prisma.adherent.findFirst.mockResolvedValue(null);
      await expect(service.proposerBeneficiaire(USER, 'sous-1', DTO)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('crée le brouillon et y ajoute la proposition de bénéficiaire', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], 'sous-1'));
      prisma.adherent.findFirst.mockResolvedValue({ id: 'adh-1', nom: 'Yao', prenom: 'Awa' });
      prisma.importAdherents.findFirst.mockResolvedValue(null);
      prisma.importAdherents.create.mockResolvedValue({ id: 'imp-1', lignesValides: [] });
      prisma.importAdherents.update.mockResolvedValue({ id: 'imp-1' });

      await service.proposerBeneficiaire(USER, 'sous-1', DTO);

      expect(prisma.importAdherents.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lignesValides: [
              expect.objectContaining({ type: 'BENEFICIAIRE', adherentId: 'adh-1', adherentNom: 'Yao Awa', lienParente: 'ENFANT' }),
            ],
          }),
        }),
      );
    });
  });

  describe('modifierPropositionAdherent / supprimerProposition / soumettrePourValidation', () => {
    const BROUILLON = {
      id: 'imp-1',
      organisationId: 'org-1',
      souscripteurId: 'sous-1',
      statut: 'BROUILLON',
      lignesValides: [
        { type: 'ADHERENT', nom: 'Yao', prenom: 'Awa', telephone: '0700000001', email: 'awa@test.ci', dateNaissance: '1990-05-14' },
      ],
    };

    it('modifierPropositionAdherent : refuse si déjà soumis (plus BROUILLON)', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-1'));
      prisma.importAdherents.findFirst.mockResolvedValue({ ...BROUILLON, statut: 'EN_ATTENTE_VALIDATION' });
      await expect(
        service.modifierPropositionAdherent(USER, 'imp-1', 0, { nom: 'X', prenom: 'Y', telephone: '0700000009', email: 'x@test.ci', dateNaissance: '1990-01-01' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('modifierPropositionAdherent : met à jour la ligne par son index', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-1'));
      prisma.importAdherents.findFirst.mockResolvedValue(BROUILLON);
      prisma.importAdherents.update.mockResolvedValue({ id: 'imp-1' });

      await service.modifierPropositionAdherent(USER, 'imp-1', 0, {
        nom: 'Yao', prenom: 'Awa', telephone: '0700000099', email: 'awa-corrige@test.ci', dateNaissance: '1990-05-14',
      });

      expect(prisma.importAdherents.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lignesValides: [expect.objectContaining({ email: 'awa-corrige@test.ci', telephone: '0700000099' })],
          }),
        }),
      );
    });

    it('supprimerProposition : retire la ligne par son index', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-1'));
      prisma.importAdherents.findFirst.mockResolvedValue(BROUILLON);
      prisma.importAdherents.update.mockResolvedValue({ id: 'imp-1' });

      await service.supprimerProposition(USER, 'imp-1', 0);

      expect(prisma.importAdherents.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lignesValides: [], nbLignesTotal: 0, nbLignesValides: 0 }) }),
      );
    });

    it('soumettrePourValidation : refuse un brouillon vide', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-1'));
      prisma.importAdherents.findFirst.mockResolvedValue({ ...BROUILLON, lignesValides: [] });
      await expect(service.soumettrePourValidation(USER, 'imp-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('soumettrePourValidation : BROUILLON → EN_ATTENTE_VALIDATION', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-1'));
      prisma.importAdherents.findFirst.mockResolvedValue(BROUILLON);
      prisma.importAdherents.update.mockResolvedValue({ id: 'imp-1', statut: 'EN_ATTENTE_VALIDATION' });

      const res = await service.soumettrePourValidation(USER, 'imp-1');

      expect(prisma.importAdherents.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'imp-1' }, data: { statut: 'EN_ATTENTE_VALIDATION' } }),
      );
      expect(res.statut).toBe('EN_ATTENTE_VALIDATION');
    });

    it("une AUTRE société ne peut ni modifier ni soumettre ce brouillon", async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-AUTRE'));
      prisma.importAdherents.findFirst.mockResolvedValue(BROUILLON);
      await expect(service.soumettrePourValidation(USER, 'imp-1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('obtenirBrouillonSociete', () => {
    it('refuse un rôle non habilité', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_RECEPTION'], 'sous-1'));
      await expect(service.obtenirBrouillonSociete(USER, 'sous-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('renvoie null si aucun brouillon en cours', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-1'));
      prisma.importAdherents.findFirst.mockResolvedValue(null);
      await expect(service.obtenirBrouillonSociete(USER, 'sous-1')).resolves.toBeNull();
    });
  });

  describe('validerImportAdherents — lignes BENEFICIAIRE (propositions société)', () => {
    it("crée le Beneficiaire et sa carte, sans exiger de police ACTIVE si le lot ne contient AUCUN adhérent", async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      prisma.importAdherents.findFirst.mockResolvedValue({
        id: 'imp-1',
        organisationId: 'org-1',
        souscripteurId: 'sous-1',
        statut: 'EN_ATTENTE_VALIDATION',
        lignesValides: [
          { type: 'BENEFICIAIRE', adherentId: 'adh-1', adherentNom: 'Yao Awa', lienParente: 'ENFANT', nom: 'Petit', prenom: 'Yao', dateNaissance: '2015-03-10', sexe: 'M' },
        ],
      });
      prisma.beneficiaire.create.mockResolvedValue({ id: 'ben-1' });
      prisma.importAdherents.update.mockResolvedValue({ id: 'imp-1', statut: 'VALIDE' });

      const res = await service.validerImportAdherents(USER, 'imp-1');

      expect(prisma.police.findFirst).not.toHaveBeenCalled();
      expect(prisma.beneficiaire.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ adherentId: 'adh-1', lienParente: 'ENFANT', sexe: 'M' }) }),
      );
      expect(cartes.genererCarteBeneficiaire).toHaveBeenCalledWith(USER, 'adh-1', 'ben-1');
      expect(res.nbAdherentsCrees).toBe(0);
      expect(res.nbBeneficiairesCrees).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Mouvements de personnel — ENTRANTS à effet différé (prisma/sql/056).
  // ═══════════════════════════════════════════════════════════════════════
  describe('importerEntrantsExcel', () => {
    it('refuse un rôle sans rapport (SOCIETE_COMPTABLE)', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_COMPTABLE'], 'sous-1'));
      const buf = await fabriquerClasseur([['Yao', 'Awa', '0700000001', 'awa@test.ci', '1990-05-14']]);
      await expect(
        service.importerEntrantsExcel(USER, 'sous-1', fichier(buf)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('crée le brouillon avec moisEffet par défaut (mois calendaire suivant)', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-1'));
      prisma.importAdherents.findFirst.mockResolvedValue(null);
      prisma.importAdherents.create.mockResolvedValue({ id: 'imp-1', lignesValides: [], erreursDetail: [] });
      prisma.importAdherents.update.mockResolvedValue({ id: 'imp-1' });
      const buf = await fabriquerClasseur([['Yao', 'Awa', '0700000001', 'awa@test.ci', '1990-05-14']]);

      await service.importerEntrantsExcel(USER, 'sous-1', fichier(buf));

      const maintenant = new Date();
      const moisSuivantAttendu = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 1));
      expect(prisma.importAdherents.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            moisEffet: moisSuivantAttendu,
            nbLignesValides: 1,
            nbLignesErreur: 0,
          }),
        }),
      );
    });

    it('respecte un moisEffet explicite (normalisé au 1er du mois)', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], 'sous-1'));
      prisma.importAdherents.findFirst.mockResolvedValue(null);
      prisma.importAdherents.create.mockResolvedValue({ id: 'imp-1', lignesValides: [], erreursDetail: [] });
      prisma.importAdherents.update.mockResolvedValue({ id: 'imp-1' });
      const buf = await fabriquerClasseur([['Yao', 'Awa', '0700000001', 'awa@test.ci', '1990-05-14']]);

      await service.importerEntrantsExcel(USER, 'sous-1', fichier(buf), '2026-12-15');

      expect(prisma.importAdherents.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ moisEffet: new Date(Date.UTC(2026, 11, 1)) }) }),
      );
    });

    it('ne ré-ajoute pas un email déjà présent dans le brouillon en cours', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-1'));
      prisma.importAdherents.findFirst.mockResolvedValue({
        id: 'imp-1',
        lignesValides: [{ type: 'ADHERENT', nom: 'Yao', prenom: 'Awa', telephone: '0700000001', email: 'awa@test.ci', dateNaissance: '1990-05-14' }],
        erreursDetail: [],
      });
      prisma.importAdherents.update.mockResolvedValue({ id: 'imp-1' });
      const buf = await fabriquerClasseur([['Yao', 'Awa', '0700000001', 'awa@test.ci', '1990-05-14']]);

      await service.importerEntrantsExcel(USER, 'sous-1', fichier(buf));

      expect(prisma.importAdherents.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ nbLignesValides: 1, nbLignesErreur: 1 }) }),
      );
    });
  });

  describe('importerSortantsExcel', () => {
    it('refuse un rôle autre que SOCIETE_ADMINISTRATION (ex. SOCIETE_ASSUREE)', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ASSUREE'], 'sous-1'));
      const buf = await fabriquerClasseurSortants([['ADH-2026-000001', 'Départ', 'RADIE']]);
      await expect(
        service.importerSortantsExcel(USER, 'sous-1', fichier(buf)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('colonnes manquantes → 400', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], 'sous-1'));
      const workbook = new ExcelJS.Workbook();
      const feuille = workbook.addWorksheet('Sortants');
      feuille.addRow(['identifiant']);
      feuille.addRow(['ADH-2026-000001']);
      const buf = Buffer.from(await workbook.xlsx.writeBuffer());
      await expect(
        service.importerSortantsExcel(USER, 'sous-1', fichier(buf)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('identifiant introuvable → listé en erreur, aucune proposition', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], 'sous-1'));
      prisma.adherent.findFirst.mockResolvedValue(null);
      const buf = await fabriquerClasseurSortants([['ADH-INCONNU', 'Départ', 'RADIE']]);

      const res = await service.importerSortantsExcel(USER, 'sous-1', fichier(buf));

      expect(res.nbProposes).toBe(0);
      expect(res.erreursDetail).toHaveLength(1);
      expect(res.erreursDetail[0].erreurs[0]).toMatch(/introuvable/);
      expect(adherents.proposerSortants).not.toHaveBeenCalled();
    });

    it('ligne valide (sans statut cible → défaut RADIE) → délègue à proposerSortants', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], 'sous-1'));
      prisma.adherent.findFirst.mockResolvedValue({ id: 'adh-1', statut: 'ACTIF' });
      adherents.proposerSortants.mockResolvedValue({ propositions: [{ adherentId: 'adh-1', statut: 'PROPOSE_SORTANT' }] });
      const buf = await fabriquerClasseurSortants([['ADH-2026-000001', 'Départ de l’entreprise', undefined]]);

      const res = await service.importerSortantsExcel(USER, 'sous-1', fichier(buf));

      expect(adherents.proposerSortants).toHaveBeenCalledWith(USER, {
        souscripteurId: 'sous-1',
        sortants: [{ adherentId: 'adh-1', statutCible: 'RADIE', motif: 'Départ de l’entreprise' }],
      });
      expect(res.nbProposes).toBe(1);
    });

    it('adhérent déjà non-ACTIF → erreur, pas de proposition', async () => {
      identity.getMe.mockResolvedValue(identite(['SOCIETE_ADMINISTRATION'], 'sous-1'));
      prisma.adherent.findFirst.mockResolvedValue({ id: 'adh-1', statut: 'SUSPENDU' });
      const buf = await fabriquerClasseurSortants([['ADH-2026-000001', 'Départ', 'RADIE']]);

      const res = await service.importerSortantsExcel(USER, 'sous-1', fichier(buf));

      expect(res.nbProposes).toBe(0);
      expect(res.erreursDetail[0].erreurs[0]).toMatch(/SUSPENDU/);
    });
  });

  describe('validerImportAdherents — moisEffet (mouvements de personnel à effet différé)', () => {
    const LIGNE_ADHERENT = { type: 'ADHERENT', nom: 'Yao', prenom: 'Awa', telephone: '0700000001', email: 'awa-moiseffet@test.ci', dateNaissance: '1990-05-14' };

    it('sans moisEffet : dateValidation non renseignée (comportement historique)', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
      prisma.importAdherents.findFirst.mockResolvedValue({
        id: 'imp-1', organisationId: 'org-1', souscripteurId: 'sous-1', statut: 'EN_ATTENTE_VALIDATION',
        lignesValides: [LIGNE_ADHERENT], moisEffet: null,
      });
      prisma.police.findFirst.mockResolvedValue({ id: 'pol-1' });
      prisma.adherent.create.mockResolvedValue({ id: 'adh-1', numeroAdherent: 'ADH-2026-000099' });
      prisma.importAdherents.update.mockResolvedValue({ id: 'imp-1', statut: 'VALIDE' });

      await service.validerImportAdherents(USER, 'imp-1');

      expect(prisma.adherent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.not.objectContaining({ dateValidation: expect.anything() }) }),
      );
    });

    it('avec moisEffet : dateValidation = veille du 1er du mois d’effet, valideParId renseigné', async () => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.importAdherents.findFirst.mockResolvedValue({
        id: 'imp-1', organisationId: 'org-1', souscripteurId: 'sous-1', statut: 'EN_ATTENTE_VALIDATION',
        lignesValides: [LIGNE_ADHERENT], moisEffet: new Date(Date.UTC(2026, 10, 1)), // 1er novembre 2026
      });
      prisma.police.findFirst.mockResolvedValue({ id: 'pol-1' });
      prisma.adherent.create.mockResolvedValue({ id: 'adh-1', numeroAdherent: 'ADH-2026-000099' });
      prisma.importAdherents.update.mockResolvedValue({ id: 'imp-1', statut: 'VALIDE' });

      await service.validerImportAdherents(USER, 'imp-1');

      expect(prisma.adherent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dateValidation: new Date(Date.UTC(2026, 9, 31)), // veille du 1er novembre = 31 octobre
            valideParId: 'u1',
          }),
        }),
      );
    });
  });
});
