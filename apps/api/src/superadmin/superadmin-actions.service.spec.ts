import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { EmailService } from '../email/email.service';
import { IdentityService } from '../identity/identity.service';
import { InvitationsService } from '../invitations/invitations.service';
import { PrismaService } from '../prisma/prisma.service';
import { SuperadminActionsService } from './superadmin-actions.service';

const USER: AuthenticatedUser = {
  sub: 'sa-1',
  email: 'armelk01+testunitaire@gmail.com',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

const superadmin = () => ({
  profil: { id: 'sa-1', organisationId: null, role: 'SUPERADMIN_PRINCIPAL' },
  permissions: { roleChain: ['SUPERADMIN_PRINCIPAL'] },
});
const nonSuperadmin = () => ({
  profil: { id: 'x', organisationId: 'org-1', role: 'ASSUREUR_INFORMATIQUE' },
  permissions: { roleChain: ['ASSUREUR_INFORMATIQUE'] },
});

const DANS_15MIN = new Date(Date.now() + 15 * 60 * 1000);
const HIER = new Date(Date.now() - 3600 * 1000);

describe('SuperadminActionsService — confirmation à deux temps', () => {
  let service: SuperadminActionsService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let invitations: { creerInvitation: jest.Mock };
  let email: { envoyerEmail: jest.Mock };

  beforeEach(async () => {
    process.env.SUPERADMIN_EMAIL = 'armelk01@gmail.com';
    prisma = {
      codeValidationSuperadmin: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      organisation: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      licenceOrganisation: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };
    invitations = {
      creerInvitation: jest.fn().mockResolvedValue({ email: 'x@y.ci', statut: 'EN_ATTENTE' }),
    };
    email = { envoyerEmail: jest.fn().mockResolvedValue({ envoye: true, id: 'em-1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SuperadminActionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: InvitationsService, useValue: invitations },
        { provide: EmailService, useValue: email },
      ],
    }).compile();

    service = moduleRef.get(SuperadminActionsService);
  });

  const dtoCreation = {
    nom: 'Nouvelle Mutuelle',
    type: 'MUTUELLE' as const,
    pays: "Côte d'Ivoire",
    premierCompteEmail: 'direction@mutuelle.ci',
  };

  it('initierCreationOrganisation refusée à un non-superadmin', async () => {
    identity.getMe.mockResolvedValue(nonSuperadmin());
    await expect(
      service.initierCreationOrganisation(USER, dtoCreation),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('initierCreationOrganisation stocke le payload + un code et envoie l’e-mail — NE crée PAS l’organisation', async () => {
    identity.getMe.mockResolvedValue(superadmin());
    prisma.codeValidationSuperadmin.create.mockImplementation(({ data }: any) => ({
      id: 'code-1',
      ...data,
      dateExpiration: DANS_15MIN,
    }));

    const res = await service.initierCreationOrganisation(USER, dtoCreation);

    expect(prisma.codeValidationSuperadmin.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'CREATION_ORGANISATION',
          statut: 'EMIS',
          code: expect.stringMatching(/^[A-Z0-9]{8}$/),
        }),
      }),
    );
    expect(email.envoyerEmail).toHaveBeenCalledWith(
      'armelk01@gmail.com',
      expect.stringContaining('Code de confirmation'),
      expect.stringContaining('Votre code de confirmation'),
    );
    expect(prisma.organisation.create).not.toHaveBeenCalled();
    expect(res).toMatchObject({ actionId: 'code-1', emailEnvoye: true });
    expect((res as any).code).toBeUndefined();
  });

  it('confirmerAction avec un code inconnu → 404', async () => {
    identity.getMe.mockResolvedValue(superadmin());
    prisma.codeValidationSuperadmin.findUnique.mockResolvedValue(null);
    await expect(
      service.confirmerAction(USER, { code: 'ZZ99ZZ99' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('confirmerAction avec un code EXPIRÉ → 410 (et passe EXPIRE)', async () => {
    identity.getMe.mockResolvedValue(superadmin());
    prisma.codeValidationSuperadmin.findUnique.mockResolvedValue({
      id: 'code-1',
      action: 'CREATION_ORGANISATION',
      statut: 'EMIS',
      dateExpiration: HIER,
      payload: {},
    });
    await expect(
      service.confirmerAction(USER, { code: 'AB23CD45' }),
    ).rejects.toBeInstanceOf(GoneException);
    expect(prisma.codeValidationSuperadmin.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { statut: 'EXPIRE' } }),
    );
    expect(prisma.organisation.create).not.toHaveBeenCalled();
  });

  it('confirmerAction avec un code déjà CONFIRME → 409', async () => {
    identity.getMe.mockResolvedValue(superadmin());
    prisma.codeValidationSuperadmin.findUnique.mockResolvedValue({
      id: 'code-1',
      action: 'CREATION_ORGANISATION',
      statut: 'CONFIRME',
      dateExpiration: DANS_15MIN,
      payload: {},
    });
    await expect(
      service.confirmerAction(USER, { code: 'AB23CD45' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('confirmerAction (CREATION valide) → crée RÉELLEMENT l’organisation + licence + invitation, marque CONFIRME', async () => {
    identity.getMe.mockResolvedValue(superadmin());
    prisma.codeValidationSuperadmin.findUnique.mockResolvedValue({
      id: 'code-1',
      action: 'CREATION_ORGANISATION',
      statut: 'EMIS',
      dateExpiration: DANS_15MIN,
      payload: {
        nom: 'Nouvelle Mutuelle',
        type: 'MUTUELLE',
        pays: "Côte d'Ivoire",
        devise: 'XOF',
        plan: 'STARTER',
        limiteAdherents: 500,
        limiteAppelsApiMois: 50000,
        dateFin: '2027-09-10',
        premierCompteEmail: 'direction@mutuelle.ci',
        premierCompteRole: 'ASSUREUR_INFORMATIQUE',
      },
    });
    prisma.organisation.create.mockResolvedValue({ id: 'org-new', nom: 'Nouvelle Mutuelle' });
    prisma.licenceOrganisation.create.mockResolvedValue({ organisationId: 'org-new', plan: 'STARTER' });

    const res = await service.confirmerAction(USER, { code: 'AB23CD45' });

    expect(prisma.organisation.create).toHaveBeenCalled();
    expect(prisma.licenceOrganisation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organisationId: 'org-new', plan: 'STARTER' }),
      }),
    );
    expect(prisma.codeValidationSuperadmin.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { statut: 'CONFIRME' } }),
    );
    expect(invitations.creerInvitation).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({
        email: 'direction@mutuelle.ci',
        rolePropose: 'ASSUREUR_INFORMATIQUE',
        organisationId: 'org-new',
      }),
    );
    expect(res).toMatchObject({ organisation: { id: 'org-new' } });
  });

  it('confirmerAction (SUSPENSION valide) → organisation + licence SUSPENDUE', async () => {
    identity.getMe.mockResolvedValue(superadmin());
    prisma.codeValidationSuperadmin.findUnique.mockResolvedValue({
      id: 'code-2',
      action: 'SUSPENSION_ORGANISATION',
      statut: 'EMIS',
      dateExpiration: DANS_15MIN,
      payload: { organisationId: 'org-1', motif: null },
    });
    prisma.organisation.findFirst.mockResolvedValue({ id: 'org-1', nom: 'ACME' });
    prisma.organisation.update.mockResolvedValue({ id: 'org-1', statut: 'SUSPENDUE' });

    const res = await service.confirmerAction(USER, { code: 'CD34EF56' });

    expect(prisma.organisation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { statut: 'SUSPENDUE' } }),
    );
    expect(prisma.licenceOrganisation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { statut: 'SUSPENDUE' } }),
    );
    expect(res).toMatchObject({ organisation: { statut: 'SUSPENDUE' } });
  });
});
