import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { SuperadminConfigService } from './superadmin-config.service';
import { CategoriesActeService } from '../reference/categories-acte.service';
import { categoriesActeServiceDeTest } from '../reference/categories-acte.testing';
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
        SuperadminConfigService,
        { provide: PrismaService, useValue: prisma },
        { provide: DependancesService, useValue: dependances },
        { provide: IdentityService, useValue: identity },
        { provide: SanteService, useValue: { etat: jest.fn().mockResolvedValue(PLATEFORME) } },
      ],
    }).compile();
    service = moduleRef.get(SuperadminConfigService);
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

  it('listerActesNational : refusé pour un non-superadmin (403)', async () => {
    identity.getMe.mockResolvedValue(informatique());
    await expect(service.listerActesNational(USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
