import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClaimsService } from './claims.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'expl@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

const identite = (roleChain: string[], organisationId: string | null = 'org-1') => ({
  profil: { id: 'u1', organisationId },
  permissions: roleChain.length ? { roleChain } : null,
});

const ACTE = {
  id: 'acte-1',
  dossierSoinsId: 'dos-1',
  categorieActe: 'CONSULTATION',
  montantPrescrit: '15000',
  quantite: 1,
};
const DOSSIER = {
  id: 'dos-1',
  organisationId: 'org-1',
  policeId: 'pol-1',
  planCouvertureId: 'gar-1',
  adherentId: 'adh-1',
  beneficiaireId: null,
};

describe('ClaimsService — soumission / verrouillage', () => {
  let service: ClaimsService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      acteDossier: { findFirst: jest.fn().mockResolvedValue(ACTE) },
      dossierSoins: { findFirst: jest.fn().mockResolvedValue(DOSSIER) },
      reclamation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn().mockResolvedValue(identite(['ASSUREUR_EXPLOITATION'])) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ClaimsService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();
    service = moduleRef.get(ClaimsService);
  });

  it('crée la réclamation à SOUMISE puis la verrouille à EN_ADJUDICATION', async () => {
    prisma.reclamation.findFirst
      .mockResolvedValueOnce(null) // pas de réclamation existante
      .mockResolvedValueOnce({ id: 'rec-1', statut: 'EN_ADJUDICATION' }); // chargerReclamation
    prisma.reclamation.create.mockResolvedValue({ id: 'rec-1', statut: 'SOUMISE' });
    prisma.reclamation.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.soumettre(USER, { acteDossierId: 'acte-1' });

    expect(prisma.reclamation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organisationId: 'org-1',
        acteDossierId: 'acte-1',
        policeId: 'pol-1',
        garantieId: 'gar-1',
        montant: '15000.00',
        typeReclamation: 'SOIN',
        statut: 'SOUMISE',
      }),
    });
    expect(prisma.reclamation.updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-1', statut: 'SOUMISE', deletedAt: null },
      data: { statut: 'EN_ADJUDICATION' },
    });
    expect(res.statut).toBe('EN_ADJUDICATION');
  });

  it('refuse une 2e soumission d’une réclamation déjà EN_ADJUDICATION (idempotence)', async () => {
    prisma.reclamation.findFirst.mockResolvedValue({
      id: 'rec-1',
      statut: 'EN_ADJUDICATION',
    });

    await expect(
      service.soumettre(USER, { acteDossierId: 'acte-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.reclamation.updateMany).not.toHaveBeenCalled();
  });

  it('refuse quand le compare-and-swap concurrent renvoie 0 ligne', async () => {
    prisma.reclamation.findFirst.mockResolvedValue({ id: 'rec-1', statut: 'SOUMISE' });
    prisma.reclamation.updateMany.mockResolvedValue({ count: 0 }); // un autre process a verrouillé

    await expect(
      service.soumettre(USER, { acteDossierId: 'acte-1' }),
    ).rejects.toThrow(/verrouillée par une soumission concurrente/);
  });

  it('verrouille une réclamation préexistante encore SOUMISE', async () => {
    prisma.reclamation.findFirst
      .mockResolvedValueOnce({ id: 'rec-1', statut: 'SOUMISE' })
      .mockResolvedValueOnce({ id: 'rec-1', statut: 'EN_ADJUDICATION' });
    prisma.reclamation.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.soumettre(USER, { acteDossierId: 'acte-1' });
    expect(prisma.reclamation.create).not.toHaveBeenCalled();
    expect(res.statut).toBe('EN_ADJUDICATION');
  });

  it('refuse un rôle non habilité (comptable)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    await expect(
      service.soumettre(USER, { acteDossierId: 'acte-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.reclamation.create).not.toHaveBeenCalled();
  });
});
