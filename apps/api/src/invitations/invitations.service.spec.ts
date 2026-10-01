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
      etablissementSante: { findFirst: jest.fn() },
      pharmacie: { findFirst: jest.fn() },
      souscripteur: { findFirst: jest.fn() },
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

  // --- scope organisation_id : champ de rattachement obligatoire ---------
  // (CENTRE_MEDICAL_*, PHARMACIE_*, SOCIETE_ADMINISTRATION créés par
  // ASSUREUR_INFORMATIQUE — cf. formulaire "Inviter un utilisateur")

  it('scope organisation_id : REFUSE un rôle CENTRE_MEDICAL_* sans etablissementId', async () => {
    connecte({ role: 'ASSUREUR_INFORMATIQUE', organisationId: 'org-1', roleChain: ['ASSUREUR_INFORMATIQUE'] });
    prisma.regleProvisioning.findFirst.mockResolvedValue({
      mode: 'CREATION_DIRECTE',
      scopeVerifie: 'organisation_id',
      roleValidateur: null,
    });

    await expect(
      service.creerInvitation(USER, {
        email: 'medecin@centre.ci',
        rolePropose: 'CENTRE_MEDICAL_MEDECIN',
      }),
    ).rejects.toThrow('Un établissement doit être sélectionné pour ce rôle.');
    expect(admin.inviterUtilisateur).not.toHaveBeenCalled();
  });

  it('scope organisation_id : REFUSE (404) un etablissementId appartenant à une AUTRE organisation', async () => {
    connecte({ role: 'ASSUREUR_INFORMATIQUE', organisationId: 'org-1', roleChain: ['ASSUREUR_INFORMATIQUE'] });
    prisma.regleProvisioning.findFirst.mockResolvedValue({
      mode: 'CREATION_DIRECTE',
      scopeVerifie: 'organisation_id',
      roleValidateur: null,
    });
    prisma.etablissementSante.findFirst.mockResolvedValue(null);

    await expect(
      service.creerInvitation(USER, {
        email: 'medecin@centre.ci',
        rolePropose: 'CENTRE_MEDICAL_MEDECIN',
        etablissementId: 'etab-dune-autre-org',
      }),
    ).rejects.toThrow('Établissement introuvable dans votre organisation.');
    expect(admin.inviterUtilisateur).not.toHaveBeenCalled();
  });

  it('scope organisation_id : accepte un rôle CENTRE_MEDICAL_* avec un etablissementId valide', async () => {
    connecte({ role: 'ASSUREUR_INFORMATIQUE', organisationId: 'org-1', roleChain: ['ASSUREUR_INFORMATIQUE'] });
    prisma.regleProvisioning.findFirst.mockResolvedValue({
      mode: 'CREATION_DIRECTE',
      scopeVerifie: 'organisation_id',
      roleValidateur: null,
    });
    prisma.etablissementSante.findFirst.mockResolvedValue({ id: 'etab-1', organisationId: 'org-1' });
    prisma._tx.invitation.create.mockImplementation(({ data }: any) => ({
      id: 'inv-cm',
      ...data,
      expireLe: DANS_72H,
      accepteLe: null,
      createdAt: new Date(),
    }));

    const res = await service.creerInvitation(USER, {
      email: 'medecin@centre.ci',
      rolePropose: 'CENTRE_MEDICAL_MEDECIN',
      etablissementId: 'etab-1',
    });

    expect(res.statut).toBe('EN_ATTENTE');
    expect(prisma._tx.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ etablissementId: 'etab-1' }),
      }),
    );
  });

  it('scope organisation_id : REFUSE un rôle PHARMACIE_* sans pharmacieId', async () => {
    connecte({ role: 'ASSUREUR_INFORMATIQUE', organisationId: 'org-1', roleChain: ['ASSUREUR_INFORMATIQUE'] });
    prisma.regleProvisioning.findFirst.mockResolvedValue({
      mode: 'CREATION_DIRECTE',
      scopeVerifie: 'organisation_id',
      roleValidateur: null,
    });

    await expect(
      service.creerInvitation(USER, {
        email: 'pharmacien@pharm.ci',
        rolePropose: 'PHARMACIE_PHARMACIEN',
      }),
    ).rejects.toThrow('Une pharmacie doit être sélectionnée pour ce rôle.');
    expect(admin.inviterUtilisateur).not.toHaveBeenCalled();
  });

  it('scope organisation_id : REFUSE (404) un pharmacieId appartenant à une AUTRE organisation', async () => {
    connecte({ role: 'ASSUREUR_INFORMATIQUE', organisationId: 'org-1', roleChain: ['ASSUREUR_INFORMATIQUE'] });
    prisma.regleProvisioning.findFirst.mockResolvedValue({
      mode: 'CREATION_DIRECTE',
      scopeVerifie: 'organisation_id',
      roleValidateur: null,
    });
    prisma.pharmacie.findFirst.mockResolvedValue(null);

    await expect(
      service.creerInvitation(USER, {
        email: 'pharmacien@pharm.ci',
        rolePropose: 'PHARMACIE_PHARMACIEN',
        pharmacieId: 'pharm-dune-autre-org',
      }),
    ).rejects.toThrow('Pharmacie introuvable dans votre organisation.');
    expect(admin.inviterUtilisateur).not.toHaveBeenCalled();
  });

  it('scope organisation_id : REFUSE un SOCIETE_ADMINISTRATION sans societeId', async () => {
    connecte({ role: 'ASSUREUR_INFORMATIQUE', organisationId: 'org-1', roleChain: ['ASSUREUR_INFORMATIQUE'] });
    prisma.regleProvisioning.findFirst.mockResolvedValue({
      mode: 'CREATION_DIRECTE',
      scopeVerifie: 'organisation_id',
      roleValidateur: null,
    });

    await expect(
      service.creerInvitation(USER, {
        email: 'admin@societe.ci',
        rolePropose: 'SOCIETE_ADMINISTRATION',
      }),
    ).rejects.toThrow('Un souscripteur doit être sélectionné pour ce rôle.');
    expect(admin.inviterUtilisateur).not.toHaveBeenCalled();
  });

  it('scope organisation_id : REFUSE (404) un societeId (souscripteur) appartenant à une AUTRE organisation', async () => {
    connecte({ role: 'ASSUREUR_INFORMATIQUE', organisationId: 'org-1', roleChain: ['ASSUREUR_INFORMATIQUE'] });
    prisma.regleProvisioning.findFirst.mockResolvedValue({
      mode: 'CREATION_DIRECTE',
      scopeVerifie: 'organisation_id',
      roleValidateur: null,
    });
    prisma.souscripteur.findFirst.mockResolvedValue(null);

    await expect(
      service.creerInvitation(USER, {
        email: 'admin@societe.ci',
        rolePropose: 'SOCIETE_ADMINISTRATION',
        societeId: 'soc-dune-autre-org',
      }),
    ).rejects.toThrow('Souscripteur introuvable dans votre organisation.');
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

  const PROPOSITION_ORG_B = {
    id: 'inv-b',
    statut: 'EN_ATTENTE_VALIDATION_INFORMATIQUE',
    roleValidateur: 'ASSUREUR_INFORMATIQUE',
    organisationId: 'org-B',
    email: 'caisse@pharm-b.ci',
    rolePropose: 'PHARMACIE_CAISSIERE',
    token: 'tok-b',
  };

  it('rejeterProposition : validateur d’une AUTRE organisation → 403, rien n’est modifié', async () => {
    connecte({ roleChain: ['ASSUREUR_INFORMATIQUE'], organisationId: 'org-A' });
    prisma.invitation.findFirst.mockResolvedValue(PROPOSITION_ORG_B);

    await expect(service.rejeterProposition(USER, 'inv-b', 'intrusion')).rejects.toThrow(
      'Proposition hors de votre organisation.',
    );
    expect(prisma._tx.invitation.update).not.toHaveBeenCalled();
  });

  it('rejeterProposition : validateur de la MÊME organisation → proposition REJETEE', async () => {
    connecte({ roleChain: ['ASSUREUR_INFORMATIQUE'], organisationId: 'org-B' });
    prisma.invitation.findFirst.mockResolvedValue(PROPOSITION_ORG_B);
    prisma._tx.invitation.update.mockImplementation(({ data }: any) => ({
      ...PROPOSITION_ORG_B,
      telephone: null,
      mode: 'PROPOSITION',
      expireLe: DANS_72H,
      accepteLe: null,
      createdAt: new Date(),
      ...data,
    }));

    const res = await service.rejeterProposition(USER, 'inv-b', 'doublon');

    expect(prisma._tx.invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-b' }, data: expect.objectContaining({ statut: 'REJETEE' }) }),
    );
    expect(res.statut).toBe('REJETEE');
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

  // --- renvoyerEmail : visibilité de l'échec d'envoi ---------------------

  it('renvoyerEmail : refuse si l’appelant n’est pas l’émetteur de l’invitation', async () => {
    connecte({ role: 'ASSUREUR_INFORMATIQUE', organisationId: 'org-1', roleChain: ['ASSUREUR_INFORMATIQUE'] });
    prisma.invitation.findFirst.mockResolvedValue({
      id: 'inv-1',
      invitePar: 'un-autre-utilisateur',
      statut: 'EN_ATTENTE',
      authUserId: 'auth-1',
      email: 'x@y.ci',
      rolePropose: 'CENTRE_MEDICAL_ACCUEIL',
      token: 'tok',
    });

    await expect(service.renvoyerEmail(USER, 'inv-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(admin.inviterUtilisateur).not.toHaveBeenCalled();
  });

  it('renvoyerEmail : refuse si l’invitation n’est pas au statut EN_ATTENTE', async () => {
    connecte({ role: 'ASSUREUR_INFORMATIQUE', organisationId: 'org-1', roleChain: ['ASSUREUR_INFORMATIQUE'] });
    prisma.invitation.findFirst.mockResolvedValue({
      id: 'inv-1',
      invitePar: USER.sub,
      statut: 'ACCEPTEE',
      authUserId: 'auth-1',
      email: 'x@y.ci',
      rolePropose: 'CENTRE_MEDICAL_ACCUEIL',
      token: 'tok',
    });

    await expect(service.renvoyerEmail(USER, 'inv-1')).rejects.toBeInstanceOf(ConflictException);
    expect(admin.inviterUtilisateur).not.toHaveBeenCalled();
  });

  it('renvoyerEmail : retente l’envoi et reflète un NOUVEL échec explicitement (pas de boucle, pas de succès inventé)', async () => {
    connecte({ role: 'ASSUREUR_INFORMATIQUE', organisationId: 'org-1', roleChain: ['ASSUREUR_INFORMATIQUE'] });
    prisma.invitation.findFirst.mockResolvedValue({
      id: 'inv-1',
      invitePar: USER.sub,
      statut: 'EN_ATTENTE',
      authUserId: 'auth-1',
      email: 'x@y.ci',
      rolePropose: 'CENTRE_MEDICAL_ACCUEIL',
      token: 'tok',
      emailEnvoye: false,
    });
    admin.inviterUtilisateur.mockResolvedValue({ authUserId: 'auth-1', emailEnvoye: false });
    prisma._tx.invitation.update.mockImplementation(({ data }: any) => ({
      id: 'inv-1',
      statut: 'EN_ATTENTE',
      mode: 'CREATION_DIRECTE',
      email: 'x@y.ci',
      rolePropose: 'CENTRE_MEDICAL_ACCUEIL',
      organisationId: 'org-1',
      roleValidateur: null,
      token: 'tok',
      expireLe: DANS_72H,
      accepteLe: null,
      createdAt: new Date(),
      ...data,
    }));

    const res = await service.renvoyerEmail(USER, 'inv-1');

    expect(admin.inviterUtilisateur).toHaveBeenCalledTimes(1);
    expect(prisma._tx.invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { emailEnvoye: false } }),
    );
    expect(res.emailEnvoye).toBe(false);
  });

  it('renvoyerEmail : succès réel reflété correctement', async () => {
    connecte({ role: 'ASSUREUR_INFORMATIQUE', organisationId: 'org-1', roleChain: ['ASSUREUR_INFORMATIQUE'] });
    prisma.invitation.findFirst.mockResolvedValue({
      id: 'inv-1',
      invitePar: USER.sub,
      statut: 'EN_ATTENTE',
      authUserId: 'auth-1',
      email: 'x@y.ci',
      rolePropose: 'CENTRE_MEDICAL_ACCUEIL',
      token: 'tok',
      emailEnvoye: false,
    });
    admin.inviterUtilisateur.mockResolvedValue({ authUserId: 'auth-1', emailEnvoye: true });
    prisma._tx.invitation.update.mockImplementation(({ data }: any) => ({
      id: 'inv-1',
      statut: 'EN_ATTENTE',
      mode: 'CREATION_DIRECTE',
      email: 'x@y.ci',
      rolePropose: 'CENTRE_MEDICAL_ACCUEIL',
      organisationId: 'org-1',
      roleValidateur: null,
      token: 'tok',
      expireLe: DANS_72H,
      accepteLe: null,
      createdAt: new Date(),
      ...data,
    }));

    const res = await service.renvoyerEmail(USER, 'inv-1');
    expect(res.emailEnvoye).toBe(true);
  });

  // --- Proposition validée : le validateur gère l'échec d'envoi -----------

  const propositionValidee = (organisationId: string) => ({
    id: 'inv-2',
    invitePar: 'pharmacien-emetteur',
    mode: 'PROPOSITION',
    roleValidateur: 'ASSUREUR_INFORMATIQUE',
    organisationId,
    statut: 'EN_ATTENTE',
    authUserId: 'auth-2',
    email: 'caissiere@y.ci',
    rolePropose: 'PHARMACIE_CAISSIERE',
    token: 'tok2',
    emailEnvoye: false,
    telephone: null,
    expireLe: DANS_72H,
    accepteLe: null,
    createdAt: new Date(),
  });

  it('renvoyerEmail : le VALIDATEUR d’une proposition (même organisation) peut renvoyer l’e-mail', async () => {
    connecte({ role: 'ASSUREUR_INFORMATIQUE', organisationId: 'org-1', roleChain: ['ASSUREUR_INFORMATIQUE'] });
    prisma.invitation.findFirst.mockResolvedValue(propositionValidee('org-1'));
    admin.inviterUtilisateur.mockResolvedValue({ authUserId: 'auth-2', emailEnvoye: false });
    prisma._tx.invitation.update.mockImplementation(({ data }: any) => ({ ...propositionValidee('org-1'), ...data }));

    const res = await service.renvoyerEmail(USER, 'inv-2');
    expect(admin.inviterUtilisateur).toHaveBeenCalledTimes(1);
    expect(res.emailEnvoye).toBe(false);
  });

  it('renvoyerEmail / revoquer : refusés au validateur d’une AUTRE organisation', async () => {
    connecte({ role: 'ASSUREUR_INFORMATIQUE', organisationId: 'org-2', roleChain: ['ASSUREUR_INFORMATIQUE'] });
    prisma.invitation.findFirst.mockResolvedValue(propositionValidee('org-1'));

    await expect(service.renvoyerEmail(USER, 'inv-2')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.revoquer(USER, 'inv-2')).rejects.toBeInstanceOf(ForbiddenException);
    expect(admin.inviterUtilisateur).not.toHaveBeenCalled();
  });

  it('listerMesInvitations : le validateur continue de voir ses propositions APRÈS validation', async () => {
    connecte({ role: 'ASSUREUR_INFORMATIQUE', organisationId: 'org-1', roleChain: ['ASSUREUR_INFORMATIQUE'] });
    prisma.invitation.findMany.mockResolvedValue([propositionValidee('org-1')]);

    const res = await service.listerMesInvitations(USER);

    const where = prisma.invitation.findMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({
      mode: 'PROPOSITION',
      roleValidateur: { in: ['ASSUREUR_INFORMATIQUE'] },
      organisationId: 'org-1',
    });
    expect(res[0]).toMatchObject({ statut: 'EN_ATTENTE', emailEnvoye: false });
  });
});
