import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { DemandesAdhesionService } from './demandes-adhesion.service';

const USER = { sub: 'u1', token: 'jwt' } as AuthenticatedUser;

const moi = (role: string, organisationId: string | null = 'org-1') => ({
  profil: { id: 'u1', role, organisationId },
  permissions: { roleChain: [role] },
});

const demande = (extra: Record<string, unknown> = {}) => ({
  id: 'dem-1',
  organisationId: 'org-1',
  nomSociete: 'Coopérative E2E',
  nombreEstime: 25,
  email: 'rh@coop.ci',
  telephone: '+225 07 00 00 00 00',
  objet: 'Demande d’adhésion',
  message: null,
  statut: 'NOUVEAU',
  emailEnvoye: false,
  traitePar: null,
  traiteLe: null,
  createdAt: new Date('2026-09-30T10:00:00Z'),
  deletedAt: null,
  ...extra,
});

describe('DemandesAdhesionService', () => {
  let service: DemandesAdhesionService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      demandeAdhesion: {
        findMany: jest.fn().mockResolvedValue([demande()]),
        findFirst: jest.fn().mockResolvedValue(demande()),
        update: jest.fn(({ data }: any) => ({ ...demande(), ...data })),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    identity = { getMe: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DemandesAdhesionService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();
    service = moduleRef.get(DemandesAdhesionService);
  });

  it.each([['ASSUREUR_INFORMATIQUE'], ['ASSUREUR_EXPLOITATION']])(
    '%s : liste les demandes de SON organisation uniquement (NOUVEAU d’abord)',
    async (role) => {
      identity.getMe.mockResolvedValue(moi(role));
      const res = await service.lister(USER);
      expect(prisma.demandeAdhesion.findMany).toHaveBeenCalledWith({
        where: { organisationId: 'org-1', deletedAt: null },
        orderBy: [{ statut: 'asc' }, { createdAt: 'desc' }],
      });
      expect(res[0]).toMatchObject({ nomSociete: 'Coopérative E2E', statut: 'NOUVEAU', emailEnvoye: false });
    },
  );

  it.each([['ASSUREUR_COMPTABLE'], ['ASSUREUR_DIRECTION'], ['CENTRE_MEDICAL_ACCUEIL'], ['ADHERENT_TITULAIRE']])(
    '%s → 403',
    async (role) => {
      identity.getMe.mockResolvedValue(moi(role));
      await expect(service.lister(USER)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.marquerTraitee(USER, 'dem-1')).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('marquerTraitee : NOUVEAU → TRAITE avec auteur et date, audité', async () => {
    identity.getMe.mockResolvedValue(moi('ASSUREUR_EXPLOITATION'));
    const res = await service.marquerTraitee(USER, 'dem-1');
    expect(prisma.demandeAdhesion.findFirst).toHaveBeenCalledWith({
      where: { id: 'dem-1', organisationId: 'org-1', deletedAt: null },
    });
    expect(prisma.demandeAdhesion.update).toHaveBeenCalledWith({
      where: { id: 'dem-1' },
      data: { statut: 'TRAITE', traitePar: 'u1', traiteLe: expect.any(Date) },
    });
    expect(res.statut).toBe('TRAITE');
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('marquerTraitee : demande d’une autre organisation → 404', async () => {
    identity.getMe.mockResolvedValue(moi('ASSUREUR_INFORMATIQUE', 'org-2'));
    prisma.demandeAdhesion.findFirst.mockResolvedValue(null);
    await expect(service.marquerTraitee(USER, 'dem-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.demandeAdhesion.update).not.toHaveBeenCalled();
  });

  it('marquerTraitee : déjà traitée → 409', async () => {
    identity.getMe.mockResolvedValue(moi('ASSUREUR_INFORMATIQUE'));
    prisma.demandeAdhesion.findFirst.mockResolvedValue(demande({ statut: 'TRAITE', traiteLe: new Date() }));
    await expect(service.marquerTraitee(USER, 'dem-1')).rejects.toBeInstanceOf(ConflictException);
  });
});
