import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CareEpisodeService } from '../care-episode/care-episode.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { PreauthorizationService } from './preauthorization.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'armelk01+testunitaire@gmail.com',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function personnelCentre(role = 'CENTRE_MEDICAL_MEDECIN', etab = 'etab-1') {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role, adherentId: null, etablissementId: etab, pharmacieId: null },
    permissions: { roleChain: [role] },
  };
}

const ACTE = { categorieActe: 'CONSULTATION' as const, libelle: 'Consultation généraliste', quantite: 1 };

describe('PreauthorizationService — Ticket de Soins (ajout d’acte)', () => {
  let service: PreauthorizationService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      ticketSoins: { findFirst: jest.fn() },
      consultationDossier: { findFirst: jest.fn() },
      acteDossier: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PreauthorizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: CareEpisodeService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(PreauthorizationService);
  });

  const ticket = (statut: string) => ({
    id: 'tkt-1',
    statut,
    dossierSoinsId: 'dos-1',
    dossier: { organisationId: 'org-1', etablissementId: 'etab-1' },
  });

  it('ajoute un acte quand le ticket est OUVERT', async () => {
    identity.getMe.mockResolvedValue(personnelCentre('CENTRE_MEDICAL_MEDECIN'));
    prisma.ticketSoins.findFirst.mockResolvedValue(ticket('OUVERT'));
    prisma.acteDossier.create.mockResolvedValue({ id: 'acte-1' });
    prisma.acteDossier.findUnique.mockResolvedValue({ id: 'acte-1', libelle: ACTE.libelle });

    const res = await service.ajouterActe(USER, 'tkt-1', ACTE);

    expect(prisma.acteDossier.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ticketSoinsId: 'tkt-1',
          dossierSoinsId: 'dos-1',
          categorieActe: 'CONSULTATION',
        }),
      }),
    );
    expect(res).toMatchObject({ id: 'acte-1' });
  });

  it('REFUSE l’ajout d’un acte à un ticket CLOTURE (409, message clair)', async () => {
    identity.getMe.mockResolvedValue(personnelCentre('CENTRE_MEDICAL_MEDECIN'));
    prisma.ticketSoins.findFirst.mockResolvedValue(ticket('CLOTURE'));

    await expect(service.ajouterActe(USER, 'tkt-1', ACTE)).rejects.toMatchObject({
      response: { message: expect.stringContaining('CLOTURE') },
    });
    await expect(service.ajouterActe(USER, 'tkt-1', ACTE)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.acteDossier.create).not.toHaveBeenCalled();
  });

  it('REFUSE l’ajout d’un acte à un ticket ANNULE (409)', async () => {
    identity.getMe.mockResolvedValue(personnelCentre('CENTRE_MEDICAL_MEDECIN'));
    prisma.ticketSoins.findFirst.mockResolvedValue(ticket('ANNULE'));
    await expect(service.ajouterActe(USER, 'tkt-1', ACTE)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('ticket introuvable → 404', async () => {
    identity.getMe.mockResolvedValue(personnelCentre('CENTRE_MEDICAL_MEDECIN'));
    prisma.ticketSoins.findFirst.mockResolvedValue(null);
    await expect(service.ajouterActe(USER, 'tkt-x', ACTE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('personnel d’un AUTRE établissement → 403', async () => {
    identity.getMe.mockResolvedValue(
      personnelCentre('CENTRE_MEDICAL_MEDECIN', 'etab-AUTRE'),
    );
    prisma.ticketSoins.findFirst.mockResolvedValue(ticket('OUVERT'));
    await expect(service.ajouterActe(USER, 'tkt-1', ACTE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rôle non autorisé (comptable pharmacie) → 403', async () => {
    identity.getMe.mockResolvedValue(personnelCentre('PHARMACIE_COMPTABLE', null as any));
    prisma.ticketSoins.findFirst.mockResolvedValue(ticket('OUVERT'));
    await expect(service.ajouterActe(USER, 'tkt-1', ACTE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
