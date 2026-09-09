import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from './plan.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'dir@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function identite(roleChain: string[], organisationId: string | null = 'org-1') {
  return {
    profil: { id: 'u1', organisationId, entite: 'ASSUREUR' },
    permissions: roleChain.length ? { roleChain } : null,
  };
}

describe('PlanService', () => {
  let service: PlanService;
  let prisma: {
    produit: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      aggregate: jest.Mock;
    };
    garantie: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      produit: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
      },
      garantie: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlanService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();

    service = moduleRef.get(PlanService);
  });

  it('crée un produit en BROUILLON version 1', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.produit.findFirst
      .mockResolvedValueOnce(null) // pas de produit actif du même nom
      .mockResolvedValueOnce({
        id: 'p1',
        organisationId: 'org-1',
        nom: 'Essentielle',
        version: 1,
        statut: 'BROUILLON',
        garanties: [],
      }); // chargerProduit
    prisma.produit.aggregate.mockResolvedValue({ _max: { version: null } });
    prisma.produit.create.mockResolvedValue({ id: 'p1' });

    const res = await service.creerProduit(USER, { nom: 'Essentielle' });

    expect(prisma.produit.create).toHaveBeenCalledWith({
      data: {
        organisationId: 'org-1',
        nom: 'Essentielle',
        version: 1,
        statut: 'BROUILLON',
      },
    });
    expect(prisma.$executeRaw).toHaveBeenCalled(); // log_audit
    expect(res.statut).toBe('BROUILLON');
  });

  it('publie un produit BROUILLON → PUBLIE avec date_publication', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_DIRECTION']));
    prisma.produit.findFirst
      .mockResolvedValueOnce({
        id: 'p1',
        organisationId: 'org-1',
        statut: 'BROUILLON',
        version: 1,
      }) // assertProduitDansPerimetre
      .mockResolvedValueOnce({
        id: 'p1',
        statut: 'PUBLIE',
        datePublication: new Date(),
        garanties: [{ id: 'g1' }],
      }); // chargerProduit
    prisma.garantie.count.mockResolvedValue(1);
    prisma.produit.update.mockResolvedValue({});

    const res = await service.publier(USER, 'p1');

    expect(prisma.produit.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { statut: 'PUBLIE', datePublication: expect.any(Date) },
    });
    expect(res.statut).toBe('PUBLIE');
  });

  it('refuse de publier un produit sans garantie', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.produit.findFirst.mockResolvedValue({
      id: 'p1',
      organisationId: 'org-1',
      statut: 'BROUILLON',
      version: 1,
    });
    prisma.garantie.count.mockResolvedValue(0);

    await expect(service.publier(USER, 'p1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.produit.update).not.toHaveBeenCalled();
  });

  it('refuse toute modification d’un produit PUBLIE (garantie, produit, ajout)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.produit.findFirst.mockResolvedValue({
      id: 'p1',
      organisationId: 'org-1',
      nom: 'Essentielle',
      statut: 'PUBLIE',
      version: 1,
    });

    await expect(
      service.modifierGarantie(USER, 'p1', 'g1', { tauxCouverture: 90 }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.modifierProduit(USER, 'p1', { nom: 'Autre' }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.ajouterGarantie(USER, 'p1', { categorieActe: 'OPTIQUE' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.garantie.update).not.toHaveBeenCalled();
    expect(prisma.garantie.create).not.toHaveBeenCalled();
    expect(prisma.produit.update).not.toHaveBeenCalled();
  });

  it('refuse la publication à un rôle non autorisé (comptable)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));

    await expect(service.publier(USER, 'p1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.produit.findFirst).not.toHaveBeenCalled();
  });

  it('refuse la gestion à un compte sans organisation', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ASSUREUR_DIRECTION'], null),
    );
    await expect(
      service.creerProduit(USER, { nom: 'X' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('crée une nouvelle version en clonant les garanties', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_DIRECTION']));
    prisma.produit.findFirst
      .mockResolvedValueOnce({
        id: 'p1',
        organisationId: 'org-1',
        nom: 'Essentielle',
        version: 1,
        statut: 'PUBLIE',
      }) // source
      .mockResolvedValueOnce(null) // pas de BROUILLON existant
      .mockResolvedValueOnce({
        id: 'p2',
        nom: 'Essentielle',
        version: 2,
        statut: 'BROUILLON',
        garanties: [{ id: 'g2' }],
      }); // chargerProduit
    prisma.produit.aggregate.mockResolvedValue({ _max: { version: 1 } });
    prisma.garantie.findMany.mockResolvedValue([
      {
        categorieActe: 'CONSULTATION',
        tauxCouverture: null,
        plafondParActe: null,
        plafondAnnuel: null,
        franchise: null,
        ticketModerateur: null,
        delaiCarenceJours: null,
        reseauSoins: 'TOUT_RESEAU',
        exclusions: [],
      },
    ]);
    prisma.produit.create.mockResolvedValue({ id: 'p2' });
    prisma.garantie.create.mockResolvedValue({ id: 'g2' });

    const res = await service.creerNouvelleVersion(USER, 'p1');

    expect(prisma.produit.create).toHaveBeenCalledWith({
      data: {
        organisationId: 'org-1',
        nom: 'Essentielle',
        version: 2,
        statut: 'BROUILLON',
      },
    });
    expect(prisma.garantie.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        produitId: 'p2',
        categorieActe: 'CONSULTATION',
        reseauSoins: 'TOUT_RESEAU',
      }),
    });
    expect(res.version).toBe(2);
  });
});
