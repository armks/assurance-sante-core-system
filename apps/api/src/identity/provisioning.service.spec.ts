import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from './identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisioningService } from './provisioning.service';

const USER: AuthenticatedUser = {
  sub: 'user-1',
  email: 'agent@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function regle(
  roleCree: string,
  entiteCode: string,
  mode = 'CREATION_DIRECTE',
  extra: Partial<{ scopeVerifie: string | null; roleValidateur: string | null }> = {},
) {
  return {
    id: `rp-${roleCree}`,
    roleCreateur: 'X',
    roleCree,
    mode,
    scopeVerifie: extra.scopeVerifie ?? (mode === 'PROPOSITION' ? 'pharmacie_id' : 'organisation_id'),
    roleValidateur: extra.roleValidateur ?? (mode === 'PROPOSITION' ? 'ASSUREUR_INFORMATIQUE' : null),
    deletedAt: null,
    cree: { code: roleCree, libelle: `Libellé ${roleCree}`, entiteCode },
  };
}

describe('ProvisioningService.rolesProposables', () => {
  let service: ProvisioningService;
  let prisma: { regleProvisioning: { findMany: jest.Mock } };
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = { regleProvisioning: { findMany: jest.fn() } };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProvisioningService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();

    service = moduleRef.get(ProvisioningService);
  });

  it('retourne les rôles créables pour ASSUREUR_INFORMATIQUE', async () => {
    identity.getMe.mockResolvedValue({
      permissions: { roleChain: ['ASSUREUR_INFORMATIQUE'] },
    });
    prisma.regleProvisioning.findMany.mockResolvedValue([
      regle('ASSUREUR_COMPTABLE', 'ASSUREUR'),
      regle('PHARMACIE_PHARMACIEN', 'PHARMACIE'),
      regle('SOCIETE_ASSUREE', 'SOCIETE_AFFILIEE'),
    ]);

    const res = await service.rolesProposables(USER);

    expect(prisma.regleProvisioning.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roleCreateur: { in: ['ASSUREUR_INFORMATIQUE'] }, deletedAt: null },
      }),
    );
    expect(res).toHaveLength(3);
    expect(res[0]).toEqual({
      code: 'ASSUREUR_COMPTABLE',
      libelle: 'Libellé ASSUREUR_COMPTABLE',
      entite: 'ASSUREUR',
      mode: 'CREATION_DIRECTE',
      scopeVerifie: 'organisation_id',
      roleValidateur: null,
    });
  });

  it('retourne une liste VIDE (pas une erreur) pour un rôle sans droit de provisioning', async () => {
    identity.getMe.mockResolvedValue({
      permissions: { roleChain: ['ASSUREUR_COMPTABLE'] },
    });
    prisma.regleProvisioning.findMany.mockResolvedValue([]);

    await expect(service.rolesProposables(USER)).resolves.toEqual([]);
  });

  it('retourne [] sans requête quand le compte n’a aucun rôle assigné', async () => {
    identity.getMe.mockResolvedValue({ permissions: null });

    const res = await service.rolesProposables(USER);

    expect(res).toEqual([]);
    expect(prisma.regleProvisioning.findMany).not.toHaveBeenCalled();
  });

  it('interroge avec toute la chaîne d’héritage (rôle adjoint → parent)', async () => {
    identity.getMe.mockResolvedValue({
      permissions: {
        roleChain: ['ASSUREUR_INFORMATIQUE_ADJOINT', 'ASSUREUR_INFORMATIQUE'],
      },
    });
    prisma.regleProvisioning.findMany.mockResolvedValue([]);

    await service.rolesProposables(USER);

    expect(prisma.regleProvisioning.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roleCreateur: {
            in: ['ASSUREUR_INFORMATIQUE_ADJOINT', 'ASSUREUR_INFORMATIQUE'],
          },
          deletedAt: null,
        },
      }),
    );
  });

  it('dédoublonne un rôle-cible atteignable via plusieurs règles', async () => {
    identity.getMe.mockResolvedValue({
      permissions: { roleChain: ['A', 'B'] },
    });
    prisma.regleProvisioning.findMany.mockResolvedValue([
      regle('PHARMACIE_COMPTABLE', 'PHARMACIE'),
      regle('PHARMACIE_COMPTABLE', 'PHARMACIE'),
    ]);

    const res = await service.rolesProposables(USER);
    expect(res).toHaveLength(1);
  });

  it('mappe correctement une règle en mode PROPOSITION (pharmacien → caissière)', async () => {
    identity.getMe.mockResolvedValue({
      permissions: { roleChain: ['PHARMACIE_PHARMACIEN'] },
    });
    prisma.regleProvisioning.findMany.mockResolvedValue([
      regle('PHARMACIE_CAISSIERE', 'PHARMACIE', 'PROPOSITION'),
    ]);

    const res = await service.rolesProposables(USER);

    expect(res).toEqual([
      {
        code: 'PHARMACIE_CAISSIERE',
        libelle: 'Libellé PHARMACIE_CAISSIERE',
        entite: 'PHARMACIE',
        mode: 'PROPOSITION',
        scopeVerifie: 'pharmacie_id',
        roleValidateur: 'ASSUREUR_INFORMATIQUE',
      },
    ]);
  });
});
