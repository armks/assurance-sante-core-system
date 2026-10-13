import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { SuperadminConfigService } from './superadmin-config.service';
import { CategoriesActeService } from '../reference/categories-acte.service';
import { categoriesActeServiceDeTest } from '../reference/categories-acte.testing';
import { LettresClesService } from '../reference/lettres-cles.service';
import { lettresClesServiceDeTest } from '../reference/lettres-cles.testing';
import { SanteService } from '../sante/sante.service';
import { DependancesService } from '../dependances/dependances.service';
import { dependancesDeTest } from '../dependances/dependances.testing';

/** Garde des dépendances (ADR-007) : tout est possible par défaut. */
let dependances: ReturnType<typeof dependancesDeTest>;
beforeEach(() => {
  dependances = dependancesDeTest();
});

const PLATEFORME = {
  statut: 'DEGRADE' as const,
  api: { statut: 'UP' as const, baseDeDonnees: 'UP' as const },
  adjudication: { statut: 'INJOIGNABLE' as const, latenceMs: null, baseDeDonnees: 'INCONNU' as const, detail: 'connexion impossible' },
  horodatage: '2026-10-07T00:00:00.000Z',
};

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

describe('SuperadminConfigService', () => {
  let service: SuperadminConfigService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      parametrePlateforme: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      organisation: { findMany: jest.fn() },
      profil: { groupBy: jest.fn().mockResolvedValue([]) },
      auditLog: { groupBy: jest.fn().mockResolvedValue([]) },
      referentielNationalActe: {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      referentielNationalMedicament: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CategoriesActeService, useValue: categoriesActeServiceDeTest() },
        { provide: LettresClesService, useValue: lettresClesServiceDeTest() },
        SuperadminConfigService,
        { provide: PrismaService, useValue: prisma },
        { provide: DependancesService, useValue: dependances },
        { provide: IdentityService, useValue: identity },
        { provide: SanteService, useValue: { etat: jest.fn().mockResolvedValue(PLATEFORME) } },
      ],
    }).compile();
    service = moduleRef.get(SuperadminConfigService);
  });

  describe('lettres-clés et cotation du catalogue (prisma/sql/080)', () => {
    beforeEach(() => {
      identity.getMe.mockResolvedValue(superadmin());
      prisma.lettreCle = {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'l-1', actif: true, ...data })),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'l-1', code: 'KC', libelle: 'Libellé', actif: true, ordre: 0, ...data })),
        delete: jest.fn(),
      };
    });

    it('creerLettreCle : code normalisé en majuscules, tracé dans l’audit ; format, doublon de code et de libellé refusés', async () => {
      const l = await service.creerLettreCle(USER, { code: ' ami ', libelle: 'Actes médico-infirmiers (fictif)' });
      expect(l).toMatchObject({ code: 'AMI' });
      expect(prisma.$executeRaw).toHaveBeenCalled();
      await expect(service.creerLettreCle(USER, { code: 'K1', libelle: 'x' })).rejects.toThrow(/1 à 4 lettres majuscules/);
      prisma.lettreCle.findUnique.mockResolvedValue({ code: 'B' });
      await expect(service.creerLettreCle(USER, { code: 'B', libelle: 'autre' })).rejects.toThrow(/existe déjà/);
      prisma.lettreCle.findUnique.mockResolvedValue(null);
      prisma.lettreCle.count.mockResolvedValue(1);
      await expect(service.creerLettreCle(USER, { code: 'QQ', libelle: 'Libellé déjà pris' })).rejects.toThrow(/porte déjà le libellé/);
    });

    it('un non-superadmin est refusé (403) sur toutes les opérations', async () => {
      identity.getMe.mockResolvedValue(informatique());
      await expect(service.creerLettreCle(USER, { code: 'B', libelle: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.supprimerLettreCle(USER, 'l-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.lettreCle.create).not.toHaveBeenCalled();
    });

    it('désactiver / supprimer passent par le registre des dépendances (refus si des actes la portent)', async () => {
      prisma.lettreCle.findUnique.mockResolvedValue({ id: 'l-1', code: 'KC', libelle: 'Lettre-clé KC', actif: true });
      await service.changerStatutLettreCle(USER, 'l-1', 'archiver');
      expect(dependances.assertPossible).toHaveBeenCalledWith(USER, 'lettreCle', 'l-1', 'archiver');
      expect(prisma.lettreCle.update).toHaveBeenCalledWith(expect.objectContaining({ data: { actif: false } }));
      await service.supprimerLettreCle(USER, 'l-1');
      expect(dependances.assertPossible).toHaveBeenCalledWith(USER, 'lettreCle', 'l-1', 'supprimer');
      expect(prisma.lettreCle.delete).toHaveBeenCalledWith({ where: { id: 'l-1' } });
      dependances.assertPossible.mockRejectedValueOnce(new Error('Suppression impossible : lié à 2 actes'));
      await expect(service.supprimerLettreCle(USER, 'l-1')).rejects.toThrow(/lié à 2 actes/);
      expect(prisma.lettreCle.delete).toHaveBeenCalledTimes(1);
    });

    it('creerActeNational : la cotation est validée (400 si incohérente) et enregistrée', async () => {
      prisma.referentielNationalActe.findFirst.mockResolvedValue(null);
      prisma.referentielNationalActe.create.mockImplementation(async ({ data }: any) => ({ id: 'a1', ...data }));
      await expect(
        service.creerActeNational(USER, { code: 'FICTIF-1', libelle: 'Fictif', lettreCleCode: 'B' } as any),
      ).rejects.toThrow(/coefficient manquant/);
      const a = await service.creerActeNational(USER, { code: 'FICTIF-1', libelle: 'Fictif', lettreCleCode: 'B', coefficient: 12, categorieGarantie: 'ANALYSES' } as any);
      expect(a).toMatchObject({ lettreCleCode: 'B', coefficient: '12.00', modeCotation: 'ISOLE', categorieGarantie: 'ANALYSES', groupeCode: null });
    });

    it('modifierActeNational : fusionne avec l’existant, valide, trace l’avant et l’après ; null efface', async () => {
      prisma.referentielNationalActe.findFirst.mockResolvedValue({
        id: 'a1', code: 'FICTIF-1', categorie: null, lettreCleCode: 'B', coefficient: { toString: () => '12.00' },
        modeCotation: 'ISOLE', categorieGarantie: 'ANALYSES', groupeCode: null,
      });
      prisma.referentielNationalActe.update.mockImplementation(async ({ data }: any) => ({ id: 'a1', ...data }));
      let maj: any = await service.modifierActeNational(USER, 'a1', { coefficient: '15,5' });
      expect(maj).toMatchObject({ lettreCleCode: 'B', coefficient: '15.50' }); // la lettre-clé existante est conservée
      await expect(service.modifierActeNational(USER, 'a1', { modeCotation: 'GROUPE' })).rejects.toThrow(/code de groupe manquant/);
      maj = await service.modifierActeNational(USER, 'a1', { lettreCleCode: null, coefficient: null });
      expect(maj).toMatchObject({ lettreCleCode: null, coefficient: null });
      const audit = prisma.$executeRaw.mock.calls.map((c: any[]) => JSON.stringify(c)).join('');
      expect(audit).toContain('MODIFICATION_ACTE_CATALOGUE_NATIONAL');
    });
  });

  it('definirParametre : un ASSUREUR_INFORMATIQUE est refusé (403)', async () => {
    identity.getMe.mockResolvedValue(informatique());
    await expect(
      service.definirParametre(USER, 'devises_supportees', { valeur: ['XOF'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.parametrePlateforme.upsert).not.toHaveBeenCalled();
  });

  it('definirParametre : le superadmin upsert la valeur JSON', async () => {
    identity.getMe.mockResolvedValue(superadmin());
    prisma.parametrePlateforme.findUnique.mockResolvedValue(null);
    prisma.parametrePlateforme.upsert.mockResolvedValue({
      id: 'p1',
      cle: 'langues',
      valeur: ['fr', 'en'],
    });

    const res = await service.definirParametre(USER, 'langues', {
      valeur: ['fr', 'en'],
    });
    expect(prisma.parametrePlateforme.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cle: 'langues' } }),
    );
    expect(res.valeur).toEqual(['fr', 'en']);
  });

  it('santeSysteme : agrège les statuts et repère les quotas dépassés', async () => {
    identity.getMe.mockResolvedValue(superadmin());
    prisma.organisation.findMany.mockResolvedValue([
      {
        id: 'o1',
        nom: 'Alpha',
        type: 'ASSUREUR',
        pays: 'CI',
        statut: 'ACTIVE',
        licence: { plan: 'STARTER', statut: 'ACTIVE', dateFin: null, limiteAdherents: 2 },
      },
      {
        id: 'o2',
        nom: 'Beta',
        type: 'MUTUELLE',
        pays: 'CI',
        statut: 'SUSPENDUE',
        licence: null,
      },
    ]);
    prisma.profil.groupBy.mockResolvedValue([
      { organisationId: 'o1', _count: { _all: 5 } },
    ]);
    prisma.auditLog.groupBy.mockResolvedValue([
      { organisationId: 'o1', _max: { createdAt: new Date('2026-09-01') } },
    ]);

    const res = await service.santeSysteme(USER);

    expect(res.resume.parStatutOrganisation).toEqual({ ACTIVE: 1, SUSPENDUE: 1 });
    expect(res.resume.parStatutLicence).toEqual({ ACTIVE: 1, SANS_LICENCE: 1 });
    expect(res.resume.organisationsQuotaDepasse).toBe(1); // o1 : 5 > 2
    const o1 = res.organisations.find((o) => o.id === 'o1')!;
    expect(o1.quotaDepasse).toBe(true);
    expect(o1.adherentsRattaches).toBe(5);
    // état de la plateforme (API, base, microservice d'adjudication) inclus
    expect(res.plateforme).toEqual(PLATEFORME);
  });

  it('creerActeNational : superadmin, statut par défaut HOMOLOGUE', async () => {
    identity.getMe.mockResolvedValue(superadmin());
    prisma.referentielNationalActe.findUnique.mockResolvedValue(null);
    prisma.referentielNationalActe.create.mockResolvedValue({
      id: 'na1',
      code: 'CI-X',
      statut: 'HOMOLOGUE',
    });

    const res = await service.creerActeNational(USER, {
      code: 'CI-X',
      libelle: 'Acte X',
    });
    expect(prisma.referentielNationalActe.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: 'CI-X', statut: 'HOMOLOGUE' }),
    });
    expect(res.statut).toBe('HOMOLOGUE');
  });

  it('listerActesNational : refusé à un rôle non habilité au catalogue (403)', async () => {
    identity.getMe.mockResolvedValue({ profil: { id: 'u9', organisationId: 'org-1' }, permissions: { roleChain: ['ASSUREUR_MEDECIN_CONSEIL'] } });
    await expect(service.listerActesNational(USER)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.homologuerNational(USER, 'actes', 'na1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('assurance informatique : met à jour le catalogue national comme le superadmin (ADR-009)', () => {
    beforeEach(() => identity.getMe.mockResolvedValue(informatique()));

    it('liste les actes du catalogue national', async () => {
      prisma.referentielNationalActe.findMany.mockResolvedValue([]);
      await expect(service.listerActesNational(USER)).resolves.toEqual([]);
    });

    it('crée un acte (audit au nom de l’auteur)', async () => {
      prisma.referentielNationalActe.findFirst.mockResolvedValue(null);
      prisma.referentielNationalActe.create.mockResolvedValue({ id: 'na1', code: 'CI-X', statut: 'HOMOLOGUE' });
      const res = await service.creerActeNational(USER, { code: 'CI-X', libelle: 'Acte X' });
      expect(res.id).toBe('na1');
    });

    it('homologue un acte PROPOSE (et refuse un acte déjà homologué ou retiré)', async () => {
      prisma.referentielNationalActe.findFirst.mockResolvedValue({ id: 'na1', statut: 'PROPOSE' });
      prisma.referentielNationalActe.update.mockResolvedValue({});
      await expect(service.homologuerNational(USER, 'actes', 'na1')).resolves.toEqual({ id: 'na1', statut: 'HOMOLOGUE' });
      expect(prisma.referentielNationalActe.update).toHaveBeenCalledWith({
        where: { id: 'na1' },
        data: expect.objectContaining({ statut: 'HOMOLOGUE', dateRetrait: null }),
      });
      prisma.referentielNationalActe.findFirst.mockResolvedValue({ id: 'na1', statut: 'HOMOLOGUE' });
      await expect(service.homologuerNational(USER, 'actes', 'na1')).rejects.toThrow(/déjà homologué/);
      prisma.referentielNationalActe.findFirst.mockResolvedValue({ id: 'na1', statut: 'RETIRE' });
      await expect(service.homologuerNational(USER, 'actes', 'na1')).rejects.toThrow(/retiré/);
    });

    it('reste refusé sur les lettres-clés (création) : superadmin seul', async () => {
      await expect(service.creerLettreCle(USER, { code: 'B', libelle: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
