import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from './identity.service';

type SousRoleRow = {
  code: string;
  entiteCode: string;
  libelle: string;
  roleParentCode: string | null;
  niveauAcces: string;
  peutValider: boolean;
  dashboardRoute: string;
};

const SOUS_ROLES: SousRoleRow[] = [
  {
    code: 'ASSUREUR_INFORMATIQUE',
    entiteCode: 'ASSUREUR',
    libelle: 'Assurance Informatique',
    roleParentCode: null,
    niveauAcces: 'ADMIN',
    peutValider: true,
    dashboardRoute: '/dashboard-assureur/informatique',
  },
  {
    code: 'ASSUREUR_INFORMATIQUE_ADJOINT',
    entiteCode: 'ASSUREUR',
    libelle: 'Assurance Informatique Adjointe',
    roleParentCode: 'ASSUREUR_INFORMATIQUE',
    niveauAcces: 'MODIFICATION',
    peutValider: false,
    dashboardRoute: '/dashboard-assureur/informatique-adjoint',
  },
  {
    code: 'ASSUREUR_MEDECIN_SOUSCRIPTEUR',
    entiteCode: 'ASSUREUR',
    libelle: 'Médecin Souscripteur',
    roleParentCode: null,
    niveauAcces: 'MODIFICATION',
    peutValider: true,
    dashboardRoute: '/dashboard-assureur/medecin-souscripteur',
  },
  {
    code: 'ASSUREUR_COMPTABLE',
    entiteCode: 'ASSUREUR',
    libelle: 'Assurance Comptable',
    roleParentCode: null,
    niveauAcces: 'MODIFICATION',
    peutValider: true,
    dashboardRoute: '/dashboard-assureur/comptable',
  },
  {
    code: 'ASSUREUR_COMPTABLE_ADJOINT',
    entiteCode: 'ASSUREUR',
    libelle: 'Assurance Comptable Adjointe',
    roleParentCode: 'ASSUREUR_COMPTABLE',
    niveauAcces: 'MODIFICATION',
    peutValider: false,
    dashboardRoute: '/dashboard-assureur/comptable-adjoint',
  },
];

const USER: AuthenticatedUser = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'agent@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function makeProfil(overrides: Record<string, unknown> = {}) {
  const role =
    'role' in overrides
      ? (overrides.role as string | null)
      : 'ASSUREUR_INFORMATIQUE_ADJOINT';
  const sousRole = role ? SOUS_ROLES.find((r) => r.code === role) ?? null : null;
  return {
    id: USER.sub,
    organisationId: '22222222-2222-2222-2222-222222222222',
    role,
    societeId: null,
    etablissementId: null,
    pharmacieId: null,
    adherentId: null,
    mfaActive: true,
    methodeConnexion: 'EMAIL_MDP',
    numeroOrdreMedecin: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    deletedAt: null,
    sousRole,
    organisation: { nom: 'Mutuelle A', slug: 'mutuelle-a', statut: 'ACTIVE', deletedAt: null },
    ...overrides,
  };
}

describe('IdentityService.getMe', () => {
  let service: IdentityService;
  let prisma: {
    profil: { findFirst: jest.Mock };
    sousRole: { findMany: jest.Mock };
    etablissementSante: { findUnique: jest.Mock };
    pharmacie: { findUnique: jest.Mock };
    souscripteur: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      profil: { findFirst: jest.fn() },
      sousRole: { findMany: jest.fn().mockResolvedValue(SOUS_ROLES) },
      etablissementSante: { findUnique: jest.fn() },
      pharmacie: { findUnique: jest.fn() },
      souscripteur: { findUnique: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [IdentityService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(IdentityService);
  });

  it('résout la chaîne d’héritage adjoint → parent et le niveau d’accès effectif', async () => {
    prisma.profil.findFirst.mockResolvedValue(makeProfil());

    const res = await service.getMe(USER);

    expect(res.permissions?.roleChain).toEqual([
      'ASSUREUR_INFORMATIQUE_ADJOINT',
      'ASSUREUR_INFORMATIQUE',
    ]);
    expect(res.permissions?.niveauAcces).toBe('ADMIN'); // hérité du parent
    // `peutValider` reste la valeur PROPRE au rôle assigné (adjoint : false),
    // sans OR sur la chaîne d'héritage.
    expect(res.permissions?.peutValider).toBe(false);
    expect(res.permissions?.dashboardRoute).toBe(
      '/dashboard-assureur/informatique-adjoint',
    );
    expect(res.permissions?.estRoleMedical).toBe(false);
    expect(res.profil.email).toBe('agent@assureur.ci');
    expect(res.profil.entite).toBe('ASSUREUR');
  });

  it('organisationSlug : organisation ACTIVE → son slug', async () => {
    prisma.profil.findFirst.mockResolvedValue(makeProfil());
    expect((await service.getMe(USER)).profil.organisationSlug).toBe('mutuelle-a');
  });

  it('superadmin (sans organisation) : accès normal, slug null', async () => {
    prisma.profil.findFirst.mockResolvedValue(makeProfil({ organisationId: null, organisation: null }));
    const res = await service.getMe(USER);
    expect(res.profil.organisationSlug).toBeNull();
    expect(res.permissions).not.toBeNull();
  });

  it('organisation SUSPENDUE → 403 ORGANISATION_SUSPENDUE, message explicite avec le nom de la société', async () => {
    prisma.profil.findFirst.mockResolvedValue(
      makeProfil({ organisation: { nom: 'Mutuelle A', slug: 'mutuelle-a', statut: 'SUSPENDUE', deletedAt: null } }),
    );
    const err = await service.getMe(USER).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({
      code: 'ORGANISATION_SUSPENDUE',
      organisation: 'Mutuelle A',
      message: expect.stringContaining('« Mutuelle A » est suspendu'),
    });
    // Coupure AVANT toute résolution de rôle / permission.
    expect(prisma.sousRole.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['ARCHIVEE', { nom: 'Mutuelle A', slug: 'mutuelle-a', statut: 'ARCHIVEE', deletedAt: null }],
    ['supprimée', { nom: 'Mutuelle A', slug: 'mutuelle-a', statut: 'ACTIVE', deletedAt: new Date() }],
    ['introuvable', null],
  ])('organisation %s → 403 ORGANISATION_INACTIVE', async (_cas, organisation) => {
    prisma.profil.findFirst.mockResolvedValue(makeProfil({ organisation }));
    const err = await service.getMe(USER).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ code: 'ORGANISATION_INACTIVE' });
  });

  it('peutValider = valeur propre au rôle : true pour le titulaire, false pour l’adjoint', async () => {
    prisma.profil.findFirst.mockResolvedValue(
      makeProfil({ role: 'ASSUREUR_INFORMATIQUE' }),
    );
    expect((await service.getMe(USER)).permissions?.peutValider).toBe(true);

    prisma.profil.findFirst.mockResolvedValue(
      makeProfil({ role: 'ASSUREUR_COMPTABLE_ADJOINT' }),
    );
    const adjointComptable = await service.getMe(USER);
    expect(adjointComptable.permissions?.peutValider).toBe(false);
    // l'héritage continue de remonter pour le reste de la chaîne
    expect(adjointComptable.permissions?.roleChain).toEqual([
      'ASSUREUR_COMPTABLE_ADJOINT',
      'ASSUREUR_COMPTABLE',
    ]);

    prisma.profil.findFirst.mockResolvedValue(
      makeProfil({ role: 'ASSUREUR_COMPTABLE' }),
    );
    expect((await service.getMe(USER)).permissions?.peutValider).toBe(true);
  });

  it('marque estRoleMedical pour ASSUREUR_MEDECIN_SOUSCRIPTEUR', async () => {
    prisma.profil.findFirst.mockResolvedValue(
      makeProfil({ role: 'ASSUREUR_MEDECIN_SOUSCRIPTEUR', numeroOrdreMedecin: 'CI-12345' }),
    );

    const res = await service.getMe(USER);

    expect(res.permissions?.roleChain).toEqual(['ASSUREUR_MEDECIN_SOUSCRIPTEUR']);
    expect(res.permissions?.estRoleMedical).toBe(true);
  });

  it('renvoie permissions=null quand aucun rôle n’est assigné', async () => {
    prisma.profil.findFirst.mockResolvedValue(makeProfil({ role: null }));

    const res = await service.getMe(USER);

    expect(res.permissions).toBeNull();
    expect(res.profil.role).toBeNull();
    expect(prisma.sousRole.findMany).not.toHaveBeenCalled();
  });

  describe('périmètre archivé (ADR-007, lot 3) : les comptes rattachés ne peuvent plus agir', () => {
    const refuse = async () => {
      const err = await service.getMe(USER).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      return err.getResponse() as { code: string; message: string };
    };

    it('établissement RESILIE (ou supprimé) → 403 PERIMETRE_ARCHIVE', async () => {
      prisma.profil.findFirst.mockResolvedValue(makeProfil({ etablissementId: 'etab-1' }));
      prisma.etablissementSante.findUnique.mockResolvedValue({ nom: 'Clinique A', statut: 'RESILIE', deletedAt: null });
      const r = await refuse();
      expect(r.code).toBe('PERIMETRE_ARCHIVE');
      expect(r.message).toContain('Clinique A');
      prisma.etablissementSante.findUnique.mockResolvedValue({ nom: 'Clinique A', statut: 'ACTIF', deletedAt: new Date() });
      await refuse();
    });

    it('pharmacie RESILIEE → 403 ; société ARCHIVE → 403', async () => {
      prisma.profil.findFirst.mockResolvedValue(makeProfil({ pharmacieId: 'ph-1' }));
      prisma.pharmacie.findUnique.mockResolvedValue({ nom: 'Pharmacie B', statut: 'RESILIEE', deletedAt: null });
      expect((await refuse()).code).toBe('PERIMETRE_ARCHIVE');
      prisma.profil.findFirst.mockResolvedValue(makeProfil({ societeId: 'soc-1' }));
      prisma.souscripteur.findUnique.mockResolvedValue({ nom: 'ACME', statut: 'ARCHIVE', deletedAt: null });
      expect((await refuse()).code).toBe('PERIMETRE_ARCHIVE');
    });

    it('compte DÉSACTIVÉ (archivage) → 403 COMPTE_DESACTIVE, même si la structure a été désarchivée depuis', async () => {
      prisma.profil.findFirst.mockResolvedValue(
        makeProfil({ etablissementId: 'etab-1', desactiveLe: new Date('2026-10-01'), desactiveMotif: "archivage de l'établissement « Clinique A »" }),
      );
      prisma.etablissementSante.findUnique.mockResolvedValue({ nom: 'Clinique A', statut: 'ACTIF', deletedAt: null });
      const r = await refuse();
      expect(r.code).toBe('COMPTE_DESACTIVE');
      expect(r.message).toContain('Clinique A');
      expect(prisma.sousRole.findMany).not.toHaveBeenCalled();
    });

    it('compte RÉVOQUÉ → 403 COMPTE_REVOQUE (statut relu en base à chaque requête), avant toute lecture de permissions', async () => {
      prisma.profil.findFirst.mockResolvedValue(makeProfil({ statut: 'REVOQUE' }));
      const r = await refuse();
      expect(r.code).toBe('COMPTE_REVOQUE');
      expect(prisma.sousRole.findMany).not.toHaveBeenCalled();
    });

    it('changement de rôle EFFECTIF IMMÉDIATEMENT : le rôle vient de la base à chaque appel, jamais du jeton', async () => {
      prisma.profil.findFirst.mockResolvedValue(makeProfil({ role: 'ASSUREUR_COMPTABLE' }));
      expect((await service.getMe(USER)).permissions?.roleChain).toEqual(['ASSUREUR_COMPTABLE']);
      prisma.profil.findFirst.mockResolvedValue(makeProfil({ role: 'ASSUREUR_MEDECIN_SOUSCRIPTEUR' }));
      const apres = await service.getMe(USER);
      expect(apres.profil.role).toBe('ASSUREUR_MEDECIN_SOUSCRIPTEUR');
      expect(apres.permissions?.roleChain).toEqual(['ASSUREUR_MEDECIN_SOUSCRIPTEUR']);
    });

    it('périmètre actif → accès normal', async () => {
      prisma.profil.findFirst.mockResolvedValue(makeProfil({ etablissementId: 'etab-1' }));
      prisma.etablissementSante.findUnique.mockResolvedValue({ nom: 'Clinique A', statut: 'ACTIF', deletedAt: null });
      expect((await service.getMe(USER)).profil.etablissementId).toBe('etab-1');
    });

    it('compte assureur (sans rattachement) : aucune lecture du périmètre', async () => {
      prisma.profil.findFirst.mockResolvedValue(makeProfil());
      await service.getMe(USER);
      expect(prisma.etablissementSante.findUnique).not.toHaveBeenCalled();
      expect(prisma.pharmacie.findUnique).not.toHaveBeenCalled();
      expect(prisma.souscripteur.findUnique).not.toHaveBeenCalled();
    });
  });

  it('rejette un compte introuvable', async () => {
    prisma.profil.findFirst.mockResolvedValue(null);
    await expect(service.getMe(USER)).rejects.toBeInstanceOf(NotFoundException);
  });
});
