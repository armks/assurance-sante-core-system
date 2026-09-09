import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceService } from './reference.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'x@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function identite(roleChain: string[], organisationId: string | null = 'org-1') {
  return {
    profil: { id: 'u1', organisationId },
    permissions: roleChain.length ? { roleChain } : null,
  };
}

describe('ReferenceService — gouvernance d’homologation', () => {
  let service: ReferenceService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      referentielActe: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      medicament: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReferenceService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();

    service = moduleRef.get(ReferenceService);
  });

  // --- Le bon rôle réussit -----------------------------------------

  it('ASSUREUR_MEDECIN_CONSEIL homologue un acte PROPOSE (succès)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_MEDECIN_CONSEIL']));
    prisma.referentielActe.findFirst
      .mockResolvedValueOnce({ id: 'a1', organisationId: 'org-1', code: 'C001', statut: 'PROPOSE' })
      .mockResolvedValueOnce({ id: 'a1', statut: 'HOMOLOGUE', homologuePar: 'u1' });
    prisma.referentielActe.update.mockResolvedValue({});

    const res = await service.homologuerActe(USER, 'a1');

    expect(prisma.referentielActe.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({ statut: 'HOMOLOGUE', homologuePar: 'u1' }),
      }),
    );
    expect(res.statut).toBe('HOMOLOGUE');
  });

  it('ASSUREUR_PHARMACIEN_CONSEIL homologue un médicament PROPOSE (succès)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_PHARMACIEN_CONSEIL']));
    prisma.medicament.findFirst
      .mockResolvedValueOnce({ id: 'm1', organisationId: 'org-1', denominationCommune: 'Amoxicilline', statutHomologation: 'PROPOSE', remboursable: false })
      .mockResolvedValueOnce({ id: 'm1', statutHomologation: 'HOMOLOGUE' });
    prisma.medicament.update.mockResolvedValue({});

    const res = await service.homologuerMedicament(USER, 'm1', { remboursable: true, tauxRemboursementStd: 80 });

    expect(prisma.medicament.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statutHomologation: 'HOMOLOGUE',
          remboursable: true,
          tauxRemboursementStd: '80.00',
        }),
      }),
    );
    expect(res.statutHomologation).toBe('HOMOLOGUE');
  });

  // --- LE CROISEMENT — le mauvais rôle échoue (403) ----------------

  it('CROISEMENT : ASSUREUR_PHARMACIEN_CONSEIL NE PEUT PAS homologuer un acte (403)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_PHARMACIEN_CONSEIL']));

    await expect(service.homologuerActe(USER, 'a1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.referentielActe.findFirst).not.toHaveBeenCalled();
    expect(prisma.referentielActe.update).not.toHaveBeenCalled();
  });

  it('CROISEMENT : ASSUREUR_MEDECIN_CONSEIL NE PEUT PAS homologuer un médicament (403)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_MEDECIN_CONSEIL']));

    await expect(
      service.homologuerMedicament(USER, 'm1', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.medicament.findFirst).not.toHaveBeenCalled();
    expect(prisma.medicament.update).not.toHaveBeenCalled();
  });

  it('ASSUREUR_INFORMATIQUE ne peut pas homologuer (ni acte ni médicament)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    await expect(service.homologuerActe(USER, 'a1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.homologuerMedicament(USER, 'm1', {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  // --- Machine à états : pas de saut d'étape ----------------------

  it('impossible d’homologuer un acte SUSPENDU sans repasser par PROPOSE', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_MEDECIN_CONSEIL']));
    prisma.referentielActe.findFirst.mockResolvedValue({
      id: 'a1', organisationId: 'org-1', code: 'C001', statut: 'SUSPENDU',
    });

    await expect(service.homologuerActe(USER, 'a1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.referentielActe.update).not.toHaveBeenCalled();
  });

  it('impossible d’homologuer un médicament RETIRE sans repasser par PROPOSE', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_PHARMACIEN_CONSEIL']));
    prisma.medicament.findFirst.mockResolvedValue({
      id: 'm1', organisationId: 'org-1', denominationCommune: 'X', statutHomologation: 'RETIRE',
    });

    await expect(
      service.homologuerMedicament(USER, 'm1', {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('re-proposition d’un acte SUSPENDU → PROPOSE (par ASSUREUR_INFORMATIQUE)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.referentielActe.findFirst
      .mockResolvedValueOnce({ id: 'a1', organisationId: 'org-1', statut: 'SUSPENDU' })
      .mockResolvedValueOnce({ id: 'a1', statut: 'PROPOSE' });
    prisma.referentielActe.update.mockResolvedValue({});

    const res = await service.reproposerActe(USER, 'a1');
    expect(prisma.referentielActe.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statut: 'PROPOSE', homologuePar: null }),
      }),
    );
    expect(res.statut).toBe('PROPOSE');
  });

  it('proposition d’un acte réservée à ASSUREUR_INFORMATIQUE', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_MEDECIN_CONSEIL']));
    await expect(
      service.proposerActe(USER, { code: 'C1', libelle: 'Consultation' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
