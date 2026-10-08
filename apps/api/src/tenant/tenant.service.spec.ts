import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from './tenant.service';
import { DependancesService } from '../dependances/dependances.service';
import { dependancesDeTest } from '../dependances/dependances.testing';

/** Garde des dépendances (ADR-007) : tout est possible par défaut. */
let dependances: ReturnType<typeof dependancesDeTest>;
beforeEach(() => {
  dependances = dependancesDeTest();
});

const USER: AuthenticatedUser = {
  sub: 'user-1',
  email: 'agent@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

/** getMe stub : profil + permissions renvoyés par IdentityService. */
function identiteAvec(overrides: {
  organisationId?: string | null;
  entite?: string | null;
  roleChain?: string[];
}) {
  return {
    profil: {
      id: 'user-1',
      organisationId:
        overrides.organisationId === undefined
          ? 'org-1'
          : overrides.organisationId,
      role: overrides.roleChain?.[0] ?? null,
      entite: overrides.entite === undefined ? 'ASSUREUR' : overrides.entite,
      email: 'agent@assureur.ci',
    },
    permissions: overrides.roleChain
      ? { roleChain: overrides.roleChain }
      : null,
  };
}

describe('TenantService', () => {
  let service: TenantService;
  let prisma: {
    souscripteur: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    membreComiteGestion: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    profil: { findMany: jest.Mock; updateMany: jest.Mock };
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
  };
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      souscripteur: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      membreComiteGestion: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      profil: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      // exécute le callback avec le mock prisma lui-même comme "tx"
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantService,
        { provide: PrismaService, useValue: prisma },
        { provide: DependancesService, useValue: dependances },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();

    service = moduleRef.get(TenantService);
  });

  it('crée un souscripteur ENTREPRISE scopé sur l’organisation de l’appelant', async () => {
    identity.getMe.mockResolvedValue(
      identiteAvec({ roleChain: ['ASSUREUR_EXPLOITATION'] }),
    );
    prisma.souscripteur.create.mockResolvedValue({ id: 'sous-1' });
    prisma.souscripteur.findFirst.mockResolvedValue({
      id: 'sous-1',
      organisationId: 'org-1',
      type: 'ENTREPRISE',
      nom: 'ACME BTP',
      membresComite: [],
    });

    const res = await service.creer(USER, {
      type: 'ENTREPRISE',
      nom: 'ACME BTP',
      secteurActivite: 'Construction',
      effectifDeclare: 120,
    });

    expect(prisma.souscripteur.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organisationId: 'org-1',
        type: 'ENTREPRISE',
        nom: 'ACME BTP',
        secteurActivite: 'Construction',
        effectifDeclare: 120,
        subventionExterne: false,
      }),
    });
    expect(prisma.membreComiteGestion.create).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalled(); // log_audit
    expect(res.id).toBe('sous-1');
  });

  it('crée un souscripteur COLLECTIVITE avec un membre de comité de gestion', async () => {
    identity.getMe.mockResolvedValue(
      identiteAvec({ roleChain: ['ASSUREUR_DIRECTION'] }),
    );
    prisma.profil.findMany.mockResolvedValue([
      { id: 'user-2', organisationId: 'org-1' },
    ]);
    prisma.souscripteur.create.mockResolvedValue({ id: 'sous-2' });
    prisma.membreComiteGestion.create.mockResolvedValue({
      id: 'm-1',
      souscripteurId: 'sous-2',
      userId: 'user-2',
      fonction: 'PRESIDENT',
    });
    prisma.souscripteur.findFirst.mockResolvedValue({
      id: 'sous-2',
      organisationId: 'org-1',
      type: 'COLLECTIVITE',
      nom: 'Mutuelle communautaire de Bouaké',
      membresComite: [{ id: 'm-1', userId: 'user-2', fonction: 'PRESIDENT' }],
    });

    const res = await service.creer(USER, {
      type: 'COLLECTIVITE',
      nom: 'Mutuelle communautaire de Bouaké',
      typeCollectivite: 'MUTUELLE_COMMUNAUTAIRE',
      organeGouvernance: 'Assemblée générale',
      membresComite: [{ userId: 'user-2', fonction: 'PRESIDENT' }],
    });

    // les profils des membres sont vérifiés (existence + même organisation)
    expect(prisma.profil.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['user-2'] }, deletedAt: null },
      select: { id: true, organisationId: true },
    });
    expect(prisma.membreComiteGestion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        souscripteurId: 'sous-2',
        userId: 'user-2',
        fonction: 'PRESIDENT',
      }),
    });
    expect(res.membresComite).toHaveLength(1);
  });

  it('refuse membresComite si le type n’est pas COLLECTIVITE', async () => {
    identity.getMe.mockResolvedValue(
      identiteAvec({ roleChain: ['ASSUREUR_DIRECTION'] }),
    );

    await expect(
      service.creer(USER, {
        type: 'ENTREPRISE',
        nom: 'X',
        membresComite: [{ userId: 'user-2', fonction: 'PRESIDENT' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.souscripteur.create).not.toHaveBeenCalled();
  });

  it('refuse l’accès quand le souscripteur appartient à une autre organisation', async () => {
    identity.getMe.mockResolvedValue(
      identiteAvec({ organisationId: 'org-1', roleChain: ['ASSUREUR_DIRECTION'] }),
    );
    // souscripteur ciblé dans org-2 : la requête scopée sur org-1 ne renvoie rien
    prisma.souscripteur.findFirst.mockResolvedValue(null);

    await expect(
      service.obtenir(USER, '11111111-1111-1111-1111-111111111111'),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.modifier(USER, '11111111-1111-1111-1111-111111111111', {
        nom: 'Tentative cross-tenant',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.souscripteur.update).not.toHaveBeenCalled();
  });

  describe('lot 3 — modification tracée, archivage', () => {
    const SOUS = { id: '11111111-1111-1111-1111-111111111111', nom: 'ACME', statut: 'ACTIF', organisationId: 'org-1', deletedAt: null };
    beforeEach(() => {
      identity.getMe.mockResolvedValue(identiteAvec({ organisationId: 'org-1', roleChain: ['ASSUREUR_DIRECTION'] }));
      prisma.souscripteur.findFirst.mockResolvedValue(SOUS);
    });
    const details = () => JSON.parse(prisma.$executeRaw.mock.calls[0][5]);

    it('modifier : garde « modifier » puis nom tracé (avant / après) à l’audit dans la transaction', async () => {
      await service.modifier(USER, SOUS.id, { nom: 'ACME Holding', secteurActivite: 'BTP' });
      expect(dependances.assertPossible).toHaveBeenCalledWith(USER, 'souscripteur', SOUS.id, 'modifier');
      expect(prisma.souscripteur.update).toHaveBeenCalledWith({ where: { id: SOUS.id }, data: { nom: 'ACME Holding', secteurActivite: 'BTP' } });
      expect(details()).toMatchObject({ nom: { avant: 'ACME', apres: 'ACME Holding' } });
    });

    it('modifier une société archivée : refusé par la garde (409), aucune écriture', async () => {
      dependances.assertPossible.mockRejectedValueOnce(new ConflictException('Modification impossible : archivée'));
      await expect(service.modifier(USER, SOUS.id, { secteurActivite: 'X' })).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.souscripteur.update).not.toHaveBeenCalled();
    });

    it('archiver / désarchiver : garde, statut ARCHIVE / ACTIF et audit de succès, sans toucher aux comptes', async () => {
      await service.changerArchivage(USER, SOUS.id, 'archiver');
      expect(dependances.assertPossible).toHaveBeenCalledWith(USER, 'souscripteur', SOUS.id, 'archiver');
      expect(prisma.souscripteur.update).toHaveBeenCalledWith({ where: { id: SOUS.id }, data: { statut: 'ARCHIVE' } });
      expect(prisma.$executeRaw.mock.calls[0][1]).toBe('ARCHIVAGE_SOUSCRIPTEUR');
      // archivage : comptes de la société désactivés, nombre tracé
      expect(prisma.profil.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.profil.updateMany).toHaveBeenCalledWith({
        where: { organisationId: 'org-1', societeId: SOUS.id, deletedAt: null, desactiveLe: null },
        data: { desactiveLe: expect.any(Date), desactiveMotif: expect.stringContaining('ACME') },
      });
      expect(JSON.parse(prisma.$executeRaw.mock.calls[0][5])).toMatchObject({ comptesDesactives: 2 });
      prisma.souscripteur.findFirst.mockResolvedValue({ ...SOUS, statut: 'ARCHIVE' });
      await service.changerArchivage(USER, SOUS.id, 'desarchiver');
      expect(prisma.souscripteur.update).toHaveBeenLastCalledWith({ where: { id: SOUS.id }, data: { statut: 'ACTIF' } });
      // désarchivage : AUCUN compte réactivé automatiquement
      expect(prisma.profil.updateMany).toHaveBeenCalledTimes(1);
    });

    it('archivage bloqué (police active…) : aucune écriture, aucun audit', async () => {
      dependances.assertPossible.mockRejectedValueOnce(new ConflictException('Archivage impossible : 2 polices actives ou suspendues'));
      await expect(service.changerArchivage(USER, SOUS.id, 'archiver')).rejects.toThrow(/2 polices actives/);
      expect(prisma.souscripteur.update).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('société d’une autre organisation : 404, rien de modifié', async () => {
      prisma.souscripteur.findFirst.mockResolvedValue(null);
      await expect(service.changerArchivage(USER, SOUS.id, 'archiver')).rejects.toBeInstanceOf(NotFoundException);
      expect(dependances.assertPossible).not.toHaveBeenCalled();
    });
  });

  it('refuse la gestion à un rôle non habilité (médecin conseil)', async () => {
    identity.getMe.mockResolvedValue(
      identiteAvec({ roleChain: ['ASSUREUR_MEDECIN_CONSEIL'] }),
    );

    await expect(
      service.creer(USER, { type: 'ENTREPRISE', nom: 'X' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ASSUREUR_COMPTABLE peut créer un souscripteur (prisma/sql/052)', async () => {
    identity.getMe.mockResolvedValue(
      identiteAvec({ roleChain: ['ASSUREUR_COMPTABLE'] }),
    );
    prisma.souscripteur.create.mockResolvedValue({ id: 'sous-2' });
    prisma.souscripteur.findFirst.mockResolvedValue({
      id: 'sous-2',
      organisationId: 'org-1',
      type: 'ENTREPRISE',
      nom: 'Créée par le comptable',
      membresComite: [],
    });

    const res = await service.creer(USER, { type: 'ENTREPRISE', nom: 'Créée par le comptable' });

    expect(res.id).toBe('sous-2');
  });

  it('refuse tout accès à un profil hors entité ASSUREUR', async () => {
    identity.getMe.mockResolvedValue(
      identiteAvec({ entite: 'PHARMACIE', roleChain: ['PHARMACIE_PHARMACIEN'] }),
    );

    await expect(service.lister(USER, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuse la création à un compte sans organisation', async () => {
    identity.getMe.mockResolvedValue(
      identiteAvec({ organisationId: null, roleChain: ['ASSUREUR_DIRECTION'] }),
    );

    await expect(
      service.creer(USER, { type: 'ENTREPRISE', nom: 'X' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
