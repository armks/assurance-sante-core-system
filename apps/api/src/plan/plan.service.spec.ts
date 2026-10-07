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
import { CategoriesActeService } from '../reference/categories-acte.service';
import {
  categoriesActeDeLaMigration,
  categoriesActeServiceDeTest,
} from '../reference/categories-acte.testing';

/** Les 11 catégories actives du référentiel (migration 067) hors CONSULTATION. */
const TOUTES_SAUF_CONSULTATION = categoriesActeDeLaMigration()
  .map((c) => c.code)
  .filter((c) => c !== 'CONSULTATION');

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
        { provide: CategoriesActeService, useValue: categoriesActeServiceDeTest() },
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
        garanties: [{ id: 'g1', categorieActe: 'CONSULTATION' }],
      }); // chargerProduit
    prisma.garantie.findMany.mockResolvedValue([{ categorieActe: 'CONSULTATION' }]);
    prisma.produit.update.mockResolvedValue({});

    const res = await service.publier(USER, 'p1', {
      categoriesNonCouvertes: TOUTES_SAUF_CONSULTATION,
    });

    expect(prisma.produit.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: {
        statut: 'PUBLIE',
        datePublication: expect.any(Date),
        categoriesNonCouvertes: TOUTES_SAUF_CONSULTATION,
      },
    });
    expect(res.statut).toBe('PUBLIE');
    expect(res.categoriesSansGarantie).toEqual(TOUTES_SAUF_CONSULTATION);
  });

  it('refuse de publier un produit sans garantie', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.produit.findFirst.mockResolvedValue({
      id: 'p1',
      organisationId: 'org-1',
      statut: 'BROUILLON',
      version: 1,
    });
    prisma.garantie.findMany.mockResolvedValue([]);

    await expect(service.publier(USER, 'p1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.produit.update).not.toHaveBeenCalled();
  });

  describe('publication : catégories sans garantie à confirmer « non couvertes »', () => {
    const BROUILLON = { id: 'p1', organisationId: 'org-1', statut: 'BROUILLON', version: 1 };
    beforeEach(() => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.produit.findFirst.mockResolvedValue(BROUILLON);
      prisma.garantie.findMany.mockResolvedValue([
        { categorieActe: 'CONSULTATION' },
        { categorieActe: 'HOSPITALISATION' },
      ]);
    });

    it('sans confirmation → 400 avec la liste des 10 catégories sans garantie, rien publié', async () => {
      const err = await service.publier(USER, 'p1').catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse().categoriesSansGarantie).toEqual(
        TOUTES_SAUF_CONSULTATION.filter((c) => c !== 'HOSPITALISATION'),
      );
      expect(prisma.produit.update).not.toHaveBeenCalled();
    });

    it('confirmation partielle → 400 ne listant que les catégories restantes', async () => {
      const confirmees = TOUTES_SAUF_CONSULTATION.filter(
        (c) => !['HOSPITALISATION', 'TRANSPORT', 'OPTIQUE'].includes(c),
      );
      const err = await service
        .publier(USER, 'p1', { categoriesNonCouvertes: confirmees })
        .catch((e) => e);
      expect(err.getResponse().categoriesSansGarantie).toEqual(['OPTIQUE', 'TRANSPORT']);
      expect(prisma.produit.update).not.toHaveBeenCalled();
    });

    it('confirmer « non couverte » une catégorie qui a une garantie → 400', async () => {
      await expect(
        service.publier(USER, 'p1', { categoriesNonCouvertes: ['CONSULTATION'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('code hors référentiel (ancien BIOLOGIE) → 400', async () => {
      await expect(
        service.publier(USER, 'p1', { categoriesNonCouvertes: ['BIOLOGIE'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('garanties : catégorie du référentiel unique', () => {
    beforeEach(() => {
      identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
      prisma.produit.findFirst.mockResolvedValue({
        id: 'p1', organisationId: 'org-1', statut: 'BROUILLON', version: 1,
      });
    });

    it('catégorie hors référentiel (ANALYSES_LABORATOIRE) → 400, rien créé', async () => {
      await expect(
        service.ajouterGarantie(USER, 'p1', { categorieActe: 'ANALYSES_LABORATOIRE', tauxCouverture: 70 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.garantie.create).not.toHaveBeenCalled();
    });

    it('deuxième garantie de la même catégorie dans le produit → 409', async () => {
      prisma.garantie.findFirst.mockResolvedValue({ id: 'g-existante' });
      await expect(
        service.ajouterGarantie(USER, 'p1', { categorieActe: 'ANALYSES', tauxCouverture: 70 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.garantie.create).not.toHaveBeenCalled();
    });
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
      service.ajouterGarantie(USER, 'p1', { categorieActe: 'OPTIQUE', tauxCouverture: 80 }),
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
