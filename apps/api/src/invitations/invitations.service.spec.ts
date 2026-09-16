import {
  ConflictException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from './invitations.service';
import { SupabaseAdminService } from './supabase-admin.service';

const USER: AuthenticatedUser = {
  sub: 'superadmin-1',
  email: 'admin@plateforme.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

const DANS_72H = new Date(Date.now() + 72 * 3600 * 1000);
const HIER = new Date(Date.now() - 3600 * 1000);

describe('InvitationsService', () => {
  let service: InvitationsService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let admin: {
    inviterUtilisateur: jest.Mock;
    definirMotDePasse: jest.Mock;
    supprimerUtilisateur: jest.Mock;
  };

  beforeEach(async () => {
    const tx = {
      invitation: { create: jest.fn(), update: jest.fn() },
      profil: { create: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    prisma = {
      _tx: tx,
      regleProvisioning: { findFirst: jest.fn() },
      invitation: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      profil: { findUnique: jest.fn().mockResolvedValue(null) },
      sousRole: { findUnique: jest.fn().mockResolvedValue(null) },
      organisation: { findFirst: jest.fn() },
      adherent: { findFirst: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ count: 0n }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    identity = { getMe: jest.fn() };
    admin = {
      inviterUtilisateur: jest
        .fn()
        .mockResolvedValue({ authUserId: 'auth-new', emailEnvoye: true }),
      definirMotDePasse: jest.fn().mockResolvedValue(undefined),
      supprimerUtilisateur: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: SupabaseAdminService, useValue: admin },
      ],
    }).compile();

    service = moduleRef.get(InvitationsService);
  });

  function connecte(overrides: Partial<any> = {}) {
    identity.getMe.mockResolvedValue({
      profil: {
        id: 'superadmin-1',
        role: 'SUPERADMIN_PRINCIPAL',
        entite: 'SUPERADMIN',
        organisationId: null,
        pharmacieId: null,
        ...overrides,
      },
      permissions: {
        roleChain: overrides.roleChain ?? ['SUPERADMIN_PRINCIPAL'],
      },
    });
  }

  it('refuse la création si aucune règle de provisioning n’autorise le rôle', async () => {
    connecte();
    prisma.regleProvisioning.findFirst.mockResolvedValue(null);

    await expect(
      service.creerInvitation(USER, {
        email: 'x@y.ci',
        rolePropose: 'ASSUREUR_COMPTABLE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(admin.inviterUtilisateur).not.toHaveBeenCalled();
  });

  it('mode CREATION_DIRECTE : vérifie la règle AVANT d’appeler l’API Admin, puis crée en EN_ATTENTE', async () => {
    connecte();
    prisma.regleProvisioning.findFirst.mockResolvedValue({
      mode: 'CREATION_DIRECTE',
      scopeVerifie: null,
      roleValidateur: null,
    });
    prisma.sousRole.findUnique.mockResolvedValue({ entiteCode: 'ASSUREUR' });
    prisma.organisation.findFirst.mockResolvedValue({ id: 'org-1' });
    prisma._tx.invitation.create.mockImplementation(({ data }: any) => ({
      id: 'inv-1',
      ...data,
      expireLe: DANS_72H,
      accepteLe: null,
      createdAt: new Date(),
    }));

    const res = await service.creerInvitation(USER, {
      email: 'info@assureur.ci',
      rolePropose: 'ASSUREUR_INFORMATIQUE',
      organisationId: 'org-1',
    });

    expect(admin.inviterUtilisateur).toHaveBeenCalledTimes(1);
    expect(res.statut).toBe('EN_ATTENTE');
    expect(res.token).toBeDefined();
    // profil scoping : organisation cible reprise telle quelle
    expect(prisma._tx.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organisationId: 'org-1',
          statut: 'EN_ATTENTE',
          authUserId: 'auth-new',
        }),
      }),
    );
  });

  it('mode PROPOSITION : crée en EN_ATTENTE_VALIDATION_INFORMATIQUE sans appeler l’API Admin', async () => {
    connecte({
      role: 'PHARMACIE_PHARMACIEN',
      entite: 'PHARMACIE',
      organisationId: 'org-1',
      pharmacieId: 'pharm-1',
      roleChain: ['PHARMACIE_PHARMACIEN'],
    });
    prisma.regleProvisioning.findFirst.mockResolvedValue({
      mode: 'PROPOSITION',
      scopeVerifie: 'pharmacie_id',
      roleValidateur: 'ASSUREUR_INFORMATIQUE',
    });
    prisma._tx.invitation.create.mockImplementation(({ data }: any) => ({
      id: 'inv-2',
      ...data,
      expireLe: DANS_72H,
      accepteLe: null,
      createdAt: new Date(),
    }));

    const res = await service.creerInvitation(USER, {
      email: 'caisse@pharm.ci',
      rolePropose: 'PHARMACIE_CAISSIERE',
    });

    expect(admin.inviterUtilisateur).not.toHaveBeenCalled();
    expect(res.statut).toBe('EN_ATTENTE_VALIDATION_INFORMATIQUE');
    expect(prisma._tx.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mode: 'PROPOSITION',
          roleValidateur: 'ASSUREUR_INFORMATIQUE',
          pharmacieId: 'pharm-1',
        }),
      }),
    );
  });

  it('scope societe_id : SOCIETE_ADMINISTRATION invite un ADHERENT_TITULAIRE de SA PROPRE société', async () => {
    connecte({
      role: 'SOCIETE_ADMINISTRATION',
      entite: 'SOCIETE_AFFILIEE',
      organisationId: 'org-1',
      societeId: 'soc-1',
      roleChain: ['SOCIETE_ADMINISTRATION'],
    });
    prisma.regleProvisioning.findFirst.mockResolvedValue({
      mode: 'CREATION_DIRECTE',
      scopeVerifie: 'societe_id',
      roleValidateur: null,
    });
    prisma.adherent.findFirst.mockResolvedValue({ id: 'adh-1', souscripteurId: 'soc-1' });
    prisma._tx.invitation.create.mockImplementation(({ data }: any) => ({
      id: 'inv-3',
      ...data,
      expireLe: DANS_72H,
      accepteLe: null,
      createdAt: new Date(),
    }));

    const res = await service.creerInvitation(USER, {
      email: 'adherent@societe.ci',
      rolePropose: 'ADHERENT_TITULAIRE',
      adherentId: 'adh-1',
    });

    expect(prisma.adherent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'adh-1', souscripteurId: 'soc-1' }) }),
    );
    expect(res.statut).toBe('EN_ATTENTE');
    expect(prisma._tx.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ societeId: 'soc-1', adherentId: 'adh-1' }),
      }),
    );
  });

  it('scope societe_id : REFUSE (404) un adherentId appartenant à une AUTRE société — jamais fait confiance à la requête', async () => {
    connecte({
      role: 'SOCIETE_ADMINISTRATION',
      entite: 'SOCIETE_AFFILIEE',
      organisationId: 'org-1',
      societeId: 'soc-1',
      roleChain: ['SOCIETE_ADMINISTRATION'],
    });
    prisma.regleProvisioning.findFirst.mockResolvedValue({
      mode: 'CREATION_DIRECTE',
      scopeVerifie: 'societe_id',
      roleValidateur: null,
    });
    // L'adhérent existe bien, mais appartient à une AUTRE société (soc-2) —
    // le findFirst scopé sur souscripteurId: 'soc-1' ne le trouve donc pas.
    prisma.adherent.findFirst.mockResolvedValue(null);

    await expect(
      service.creerInvitation(USER, {
        email: 'intrus@autre-societe.ci',
        rolePropose: 'ADHERENT_TITULAIRE',
        adherentId: 'adh-dune-autre-societe',
      }),
    ).rejects.toThrow('Adhérent introuvable pour votre société.');
    expect(admin.inviterUtilisateur).not.toHaveBeenCalled();
  });

  it('scope societe_id : REFUSE (403) un compte sans société rattachée', async () => {
    connecte({
      role: 'SOCIETE_ADMINISTRATION',
      entite: 'SOCIETE_AFFILIEE',
      organisationId: 'org-1',
      societeId: null,
      roleChain: ['SOCIETE_ADMINISTRATION'],
    });
    prisma.regleProvisioning.findFirst.mockResolvedValue({
      mode: 'CREATION_DIRECTE',
      scopeVerifie: 'societe_id',
      roleValidateur: null,
    });

    await expect(
      service.creerInvitation(USER, {
        email: 'adherent@societe.ci',
        rolePropose: 'ADHERENT_TITULAIRE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(admin.inviterUtilisateur).not.toHaveBeenCalled();
  });

  it('validerProposition : refusée si l’appelant n’a pas le rôle validateur', async () => {
    connecte({ roleChain: ['ASSUREUR_COMPTABLE'] });
    prisma.invitation.findFirst.mockResolvedValue({
      id: 'inv-2',
      statut: 'EN_ATTENTE_VALIDATION_INFORMATIQUE',
      roleValidateur: 'ASSUREUR_INFORMATIQUE',
      organisationId: 'org-1',
      email: 'caisse@pharm.ci',
      rolePropose: 'PHARMACIE_CAISSIERE',
      token: 'tok',
    });

    await expect(
      service.validerProposition(USER, 'inv-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(admin.inviterUtilisateur).not.toHaveBeenCalled();
  });

  it('validerProposition : déclenche l’invitation et passe en EN_ATTENTE', async () => {
    connecte({ roleChain: ['ASSUREUR_INFORMATIQUE'], organisationId: 'org-1' });
    prisma.invitation.findFirst.mockResolvedValue({
      id: 'inv-2',
      statut: 'EN_ATTENTE_VALIDATION_INFORMATIQUE',
      roleValidateur: 'ASSUREUR_INFORMATIQUE',
      organisationId: 'org-1',
      email: 'caisse@pharm.ci',
      rolePropose: 'PHARMACIE_CAISSIERE',
      token: 'tok',
    });
    prisma._tx.invitation.update.mockImplementation(({ data }: any) => ({
      id: 'inv-2',
      email: 'caisse@pharm.ci',
      telephone: null,
      rolePropose: 'PHARMACIE_CAISSIERE',
      organisationId: 'org-1',
      mode: 'PROPOSITION',
      roleValidateur: 'ASSUREUR_INFORMATIQUE',
      token: 'tok',
      expireLe: DANS_72H,
      accepteLe: null,
      createdAt: new Date(),
      ...data,
    }));

    const res = await service.validerProposition(USER, 'inv-2');

    expect(admin.inviterUtilisateur).toHaveBeenCalledTimes(1);
    expect(res.statut).toBe('EN_ATTENTE');
  });

  it('accepterInvitation : refuse une invitation expirée (410)', async () => {
    prisma.invitation.findFirst.mockResolvedValue({
      id: 'inv-1',
      statut: 'EN_ATTENTE',
      expireLe: HIER,
      authUserId: 'auth-new',
    });

    await expect(
      service.accepterInvitation({ token: 'x'.repeat(30), motDePasse: 'abcd1234' }),
    ).rejects.toBeInstanceOf(GoneException);
    expect(admin.definirMotDePasse).not.toHaveBeenCalled();
  });

  it('accepterInvitation : refuse tant que la proposition n’est pas validée', async () => {
    prisma.invitation.findFirst.mockResolvedValue({
      id: 'inv-2',
      statut: 'EN_ATTENTE_VALIDATION_INFORMATIQUE',
      expireLe: DANS_72H,
      authUserId: null,
    });

    await expect(
      service.accepterInvitation({ token: 'x'.repeat(30), motDePasse: 'abcd1234' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepterInvitation : pose le mot de passe de l’invité et crée le profil (statut ACCEPTEE)', async () => {
    prisma.invitation.findFirst.mockResolvedValue({
      id: 'inv-1',
      statut: 'EN_ATTENTE',
      expireLe: DANS_72H,
      authUserId: 'auth-new',
      rolePropose: 'ASSUREUR_INFORMATIQUE',
      organisationId: 'org-1',
      societeId: null,
      etablissementId: null,
      pharmacieId: null,
      adherentId: null,
      email: 'info@assureur.ci',
    });
    prisma.sousRole.findUnique.mockResolvedValue({
      dashboardRoute: '/dashboard-assureur/informatique',
    });

    const res = await service.accepterInvitation({
      token: 'x'.repeat(30),
      motDePasse: 'Secret123',
    });

    expect(admin.definirMotDePasse).toHaveBeenCalledWith('auth-new', 'Secret123');
    expect(prisma._tx.profil.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'auth-new',
          role: 'ASSUREUR_INFORMATIQUE',
          organisationId: 'org-1',
        }),
      }),
    );
    expect(prisma._tx.invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statut: 'ACCEPTEE' }),
      }),
    );
    expect(res).toMatchObject({
      ok: true,
      dashboardRoute: '/dashboard-assureur/informatique',
    });
  });
});
