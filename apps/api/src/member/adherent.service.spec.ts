import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdherentService } from './adherent.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'expl@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

const identite = (
  roleChain: string[],
  extra: {
    organisationId?: string | null;
    societeId?: string | null;
    entite?: string | null;
  } = {},
) => ({
  profil: {
    id: 'u1',
    organisationId:
      extra.organisationId === undefined ? 'org-1' : extra.organisationId,
    societeId: extra.societeId ?? null,
    entite: extra.entite ?? null,
  },
  permissions: roleChain.length ? { roleChain } : null,
});

const SOUSCRIPTEUR = { id: 'sous-1', organisationId: 'org-1', deletedAt: null };

const ADHERENT_CREE = {
  id: 'adh-1',
  organisationId: 'org-1',
  souscripteurId: 'sous-1',
  numeroAdherent: 'ADH-2026-000007',
  numeroCarte: 'CM-0000000042',
  nom: 'Konan',
  prenom: 'Yao',
  statut: 'ACTIF',
};

describe('AdherentService — fichier des membres', () => {
  let service: AdherentService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      souscripteur: { findFirst: jest.fn().mockResolvedValue(SOUSCRIPTEUR) },
      police: { findFirst: jest.fn() },
      adherent: {
        create: jest.fn().mockResolvedValue(ADHERENT_CREE),
        findFirst: jest.fn().mockResolvedValue({
          ...ADHERENT_CREE,
          beneficiaires: [],
          souscripteur: { id: 'sous-1', nom: 'ACME', type: 'ENTREPRISE' },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      beneficiaire: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'ben-1', numeroCarte: 'CM-0000000043' }),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'ben-1', statut: 'ACTIF' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = {
      getMe: jest.fn().mockResolvedValue(identite(['ASSUREUR_EXPLOITATION'])),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdherentService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();
    service = moduleRef.get(AdherentService);
  });

  it('crée un adhérent et expose les numéros générés en base', async () => {
    const res = await service.creerAdherent(USER, {
      souscripteurId: 'sous-1',
      nom: 'Konan',
      prenom: 'Yao',
      dateNaissance: '1990-05-14',
      sexe: 'M',
    });

    expect(prisma.adherent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organisationId: 'org-1',
          souscripteurId: 'sous-1',
          nom: 'Konan',
        }),
      }),
    );
    // pas de numero_adherent/numero_carte fournis : générés par la DB
    expect(prisma.adherent.create.mock.calls[0][0].data).not.toHaveProperty(
      'numeroAdherent',
    );
    expect(res.numeroAdherent).toBe('ADH-2026-000007');
    expect(res.numeroCarte).toBe('CM-0000000042');
    expect(prisma.$executeRaw).toHaveBeenCalled(); // audit
  });

  it('ajoute un bénéficiaire à un adhérent', async () => {
    const res = await service.ajouterBeneficiaire(USER, 'adh-1', {
      lienParente: 'ENFANT',
      nom: 'Konan',
      prenom: 'Awa',
      dateNaissance: '2015-03-02',
      sexe: 'F',
    });

    expect(prisma.beneficiaire.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adherentId: 'adh-1',
          lienParente: 'ENFANT',
        }),
      }),
    );
    expect(res).toMatchObject({ id: 'ben-1' });
  });

  it('refuse la création par un rôle non habilité (comptable)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    await expect(
      service.creerAdherent(USER, {
        souscripteurId: 'sous-1',
        nom: 'X',
        prenom: 'Y',
        dateNaissance: '1990-01-01',
        sexe: 'M',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.adherent.create).not.toHaveBeenCalled();
  });

  it('SOCIETE_ADMINISTRATION crée un adhérent pour SON souscripteur', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_ADMINISTRATION'], { societeId: 'sous-1' }),
    );
    await service.creerAdherent(USER, {
      souscripteurId: 'sous-1',
      nom: 'A',
      prenom: 'B',
      dateNaissance: '1990-01-01',
      sexe: 'F',
    });
    expect(prisma.adherent.create).toHaveBeenCalled();
  });

  it('SOCIETE_ADMINISTRATION ne peut PAS créer pour un autre souscripteur', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_ADMINISTRATION'], { societeId: 'un-autre' }),
    );
    await expect(
      service.creerAdherent(USER, {
        souscripteurId: 'sous-1',
        nom: 'A',
        prenom: 'B',
        dateNaissance: '1990-01-01',
        sexe: 'F',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.adherent.create).not.toHaveBeenCalled();
  });

  it('change le statut d’un adhérent en RADIE (avec audit)', async () => {
    const res = await service.changerStatutAdherent(USER, 'adh-1', {
      statut: 'RADIE',
      motif: 'Départ',
    });

    expect(prisma.adherent.update).toHaveBeenCalledWith({
      where: { id: 'adh-1' },
      data: { statut: 'RADIE' },
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(res).toBeDefined();
  });

  it('refuse un compte sans organisation', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ASSUREUR_EXPLOITATION'], { organisationId: null }),
    );
    await expect(
      service.listerAdherents(USER, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Lecture scopée à TOUT rôle SOCIETE_AFFILIEE (pas seulement
  //  SOCIETE_ADMINISTRATION, qui seul a le droit d'écrire) — régression du
  //  filtrage étroit sur ROLE_GESTION_MEMBRE_SOCIETE (audit filière société).
  // ═══════════════════════════════════════════════════════════════════
  it('SOCIETE_ASSUREE ne liste que les adhérents de SA société', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_ASSUREE'], {
        societeId: 'sous-1',
        entite: 'SOCIETE_AFFILIEE',
      }),
    );
    await service.listerAdherents(USER, {});
    expect(prisma.adherent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ souscripteurId: 'sous-1' }),
      }),
    );
  });

  it('SOCIETE_COMPTABLE ne peut PAS lire un adhérent d’une autre société (404, pas de fuite)', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_COMPTABLE'], {
        societeId: 'une-autre-societe',
        entite: 'SOCIETE_AFFILIEE',
      }),
    );
    await expect(
      service.obtenirAdherent(USER, 'adh-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('SOCIETE_RECEPTION lit un adhérent de SA société', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOCIETE_RECEPTION'], {
        societeId: 'sous-1',
        entite: 'SOCIETE_AFFILIEE',
      }),
    );
    const res = await service.obtenirAdherent(USER, 'adh-1');
    expect(res).toBeDefined();
  });
});
