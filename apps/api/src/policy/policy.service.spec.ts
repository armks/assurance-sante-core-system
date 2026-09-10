import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from './policy.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'expl@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function identite(
  roleChain: string[],
  opts: { organisationId?: string | null; entite?: string | null } = {},
) {
  return {
    profil: {
      id: 'u1',
      organisationId:
        opts.organisationId === undefined ? 'org-1' : opts.organisationId,
      entite: opts.entite === undefined ? 'ASSUREUR' : opts.entite,
      societeId: null,
    },
    permissions: roleChain.length ? { roleChain } : null,
  };
}

describe('PolicyService', () => {
  let service: PolicyService;
  let prisma: {
    police: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    souscripteur: { findFirst: jest.Mock };
    produit: { findFirst: jest.Mock; findUnique: jest.Mock };
    avenant: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      police: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      souscripteur: { findFirst: jest.fn() },
      produit: { findFirst: jest.fn(), findUnique: jest.fn() },
      avenant: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PolicyService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();

    service = moduleRef.get(PolicyService);
  });

  it('crée un devis sur un produit PUBLIE', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    prisma.souscripteur.findFirst.mockResolvedValue({
      id: 's1',
      organisationId: 'org-1',
    });
    prisma.produit.findFirst.mockResolvedValue({
      id: 'pr1',
      organisationId: 'org-1',
      statut: 'PUBLIE',
      nom: 'Essentielle',
      version: 1,
    });
    prisma.police.create.mockResolvedValue({
      id: 'po1',
      numeroPolice: 'POL-2026-000001',
    });
    prisma.police.findFirst.mockResolvedValue({
      id: 'po1',
      statut: 'DEVIS',
      avenants: [],
    });

    const res = await service.creerDevis(USER, {
      souscripteurId: 's1',
      produitId: 'pr1',
    });

    expect(prisma.police.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organisationId: 'org-1',
        souscripteurId: 's1',
        produitId: 'pr1',
        statut: 'DEVIS',
      }),
    });
    expect(res.statut).toBe('DEVIS');
  });

  it('refuse de créer un devis sur un produit BROUILLON', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    prisma.souscripteur.findFirst.mockResolvedValue({
      id: 's1',
      organisationId: 'org-1',
    });
    prisma.produit.findFirst.mockResolvedValue({
      id: 'pr1',
      organisationId: 'org-1',
      statut: 'BROUILLON',
      nom: 'Essentielle',
      version: 1,
    });

    await expect(
      service.creerDevis(USER, { souscripteurId: 's1', produitId: 'pr1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.police.create).not.toHaveBeenCalled();
  });

  it('souscrit une police DEVIS → ACTIVE (via EN_SOUSCRIPTION)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    prisma.police.findFirst
      .mockResolvedValueOnce({
        id: 'po1',
        organisationId: 'org-1',
        produitId: 'pr1',
        statut: 'DEVIS',
        dateDebut: null,
        dateFin: null,
      })
      .mockResolvedValueOnce({
        id: 'po1',
        statut: 'ACTIVE',
        dateDebut: new Date('2026-01-01'),
        dateFin: new Date('2027-01-01'),
        avenants: [],
      });
    prisma.produit.findUnique.mockResolvedValue({ statut: 'PUBLIE' });

    const res = await service.souscrire(USER, 'po1', {
      dateDebut: '2026-01-01',
    });

    expect(prisma.police.update).toHaveBeenCalledWith({
      where: { id: 'po1' },
      data: expect.objectContaining({ statut: 'ACTIVE' }),
    });
    const data = prisma.police.update.mock.calls[0][0].data;
    expect(data.dateDebut).toBeInstanceOf(Date);
    expect(data.dateFin).toBeInstanceOf(Date);
    expect(res.statut).toBe('ACTIVE');
  });

  it('refuse une transition invalide (DEVIS → ACTIVE en direct)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_DIRECTION']));
    prisma.police.findFirst.mockResolvedValue({
      id: 'po1',
      organisationId: 'org-1',
      statut: 'DEVIS',
    });

    await expect(
      service.changerStatut(USER, 'po1', 'ACTIVE'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.police.update).not.toHaveBeenCalled();
  });

  it('refuse ACTIVE → DEVIS et RESILIEE → ACTIVE', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_DIRECTION']));

    prisma.police.findFirst.mockResolvedValueOnce({
      id: 'po1',
      organisationId: 'org-1',
      statut: 'ACTIVE',
    });
    await expect(
      service.changerStatut(USER, 'po1', 'DEVIS'),
    ).rejects.toBeInstanceOf(ConflictException);

    prisma.police.findFirst.mockResolvedValueOnce({
      id: 'po1',
      organisationId: 'org-1',
      statut: 'RESILIEE',
    });
    await expect(
      service.changerStatut(USER, 'po1', 'ACTIVE'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('autorise SUSPENDUE → ACTIVE (réactivation) et ACTIVE → SUSPENDUE', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_DIRECTION']));
    prisma.police.findFirst
      .mockResolvedValueOnce({
        id: 'po1',
        organisationId: 'org-1',
        statut: 'ACTIVE',
        dateFin: new Date('2027-01-01'),
      })
      .mockResolvedValueOnce({ id: 'po1', statut: 'SUSPENDUE', avenants: [] });

    const res = await service.changerStatut(USER, 'po1', 'SUSPENDUE');
    expect(prisma.police.update).toHaveBeenCalledWith({
      where: { id: 'po1' },
      data: { statut: 'SUSPENDUE' },
    });
    expect(res.statut).toBe('SUSPENDUE');
  });

  it('calcule la proratisation d’un avenant AJOUT_ADHERENT en milieu de période', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    prisma.police.findFirst.mockResolvedValue({
      id: 'po1',
      organisationId: 'org-1',
      statut: 'ACTIVE',
      dateDebut: new Date('2026-01-01'),
      dateFin: new Date('2026-12-31'),
    });
    prisma.avenant.create.mockResolvedValue({ id: 'av1' });

    await service.creerAvenant(USER, 'po1', {
      type: 'AJOUT_ADHERENT',
      dateEffet: '2026-07-01',
      tarifMensuelFormule: 10000,
    });

    // jours_total = 364 (2026 non bissextile), jours_restants = 183
    // 10000 * 183 / 364 = 5027.4725... -> 5027.47
    expect(prisma.avenant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        policeId: 'po1',
        type: 'AJOUT_ADHERENT',
        proratisationAppliquee: true,
        impactCotisation: '5027.47',
      }),
    });
  });

  it('refuse un avenant sur une police non ACTIVE', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    prisma.police.findFirst.mockResolvedValue({
      id: 'po1',
      organisationId: 'org-1',
      statut: 'DEVIS',
    });

    await expect(
      service.creerAvenant(USER, 'po1', {
        type: 'AJOUT_ADHERENT',
        dateEffet: '2026-07-01',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('actionsDisponibles : DEVIS → seulement « souscrire »', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    prisma.police.findFirst.mockResolvedValue({
      id: 'po1',
      statut: 'DEVIS',
      avenants: [],
    });
    const res = await service.actionsDisponibles(USER, 'po1');
    expect(res.statut).toBe('DEVIS');
    expect(res.transitions).toEqual(['EN_SOUSCRIPTION']);
    expect(res.actions.map((a) => a.cle)).toEqual(['souscrire']);
    expect(res.actions[0].endpoint).toBe('souscrire');
  });

  it('actionsDisponibles : ACTIVE → 4 transitions /statut (dont 2 danger)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    prisma.police.findFirst.mockResolvedValue({
      id: 'po1',
      statut: 'ACTIVE',
      avenants: [],
    });
    const res = await service.actionsDisponibles(USER, 'po1');
    expect(res.actions.map((a) => a.cle).sort()).toEqual(
      ['NON_RENOUVELEE', 'RENOUVELEE', 'RESILIEE', 'SUSPENDUE'].sort(),
    );
    expect(res.actions.every((a) => a.endpoint === 'statut')).toBe(true);
    expect(res.actions.filter((a) => a.danger).map((a) => a.cle).sort()).toEqual(
      ['NON_RENOUVELEE', 'RESILIEE'],
    );
  });

  it('actionsDisponibles : RESILIEE (terminal) → aucune action', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    prisma.police.findFirst.mockResolvedValue({
      id: 'po1',
      statut: 'RESILIEE',
      avenants: [],
    });
    const res = await service.actionsDisponibles(USER, 'po1');
    expect(res.actions).toEqual([]);
  });

  it('actionsDisponibles : SUSPENDUE → « Réactiver » (ACTIVE via /statut)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    prisma.police.findFirst.mockResolvedValue({
      id: 'po1',
      statut: 'SUSPENDUE',
      avenants: [],
    });
    const res = await service.actionsDisponibles(USER, 'po1');
    expect(res.actions).toHaveLength(1);
    expect(res.actions[0]).toMatchObject({
      cle: 'ACTIVE',
      endpoint: 'statut',
      statutCible: 'ACTIVE',
    });
  });

  it('simulerAvenant : proratisation identique à creerAvenant, sans persistance', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    prisma.police.findFirst.mockResolvedValue({
      id: 'po1',
      organisationId: 'org-1',
      statut: 'ACTIVE',
      dateDebut: new Date('2026-01-01'),
      dateFin: new Date('2026-12-31'),
    });

    const res = await service.simulerAvenant(USER, 'po1', {
      type: 'AJOUT_ADHERENT',
      dateEffet: '2026-07-01',
      tarifMensuelFormule: 10000,
    });

    expect(res).toMatchObject({
      proratisationAppliquee: true,
      impactCotisation: '5027.47',
      joursTotal: 364,
      joursRestants: 183,
    });
    expect(prisma.avenant.create).not.toHaveBeenCalled();
  });

  it('refuse la gestion à un rôle non habilité (comptable)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    await expect(
      service.creerDevis(USER, { souscripteurId: 's1', produitId: 'pr1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
