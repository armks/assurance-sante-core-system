import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from './identity.service';
import { RoleProposable } from './provisioning.types';

/**
 * ProvisioningService — expose, pour l'utilisateur connecté, la liste des
 * sous-rôles qu'il a le droit de créer ou de proposer d'après `regles_provisioning`
 * (v9 §1.4 / §1.5).
 *
 * C'est cette liste qui alimente le formulaire de création de compte côté
 * Next.js : elle est calculée à partir des MÊMES règles que la policy RLS
 * `profils_insert_provisioning`, donc le formulaire ne proposera jamais un rôle
 * que la RLS refuserait ensuite.
 */
@Injectable()
export class ProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  async rolesProposables(user: AuthenticatedUser): Promise<RoleProposable[]> {
    const { permissions } = await this.identity.getMe(user);
    // roleChain = rôle propre + parents (héritage adjoint, v6 §3).
    const roleChain = permissions?.roleChain ?? [];
    if (roleChain.length === 0) {
      // compte sans rôle assigné : aucune règle applicable, liste vide (pas d'erreur)
      return [];
    }

    const regles = await this.prisma.regleProvisioning.findMany({
      where: { roleCreateur: { in: roleChain }, deletedAt: null },
      include: { cree: true },
      orderBy: [{ cree: { entiteCode: 'asc' } }, { roleCree: 'asc' }],
    });

    // Dédoublonnage : un même rôle-cible peut être atteignable via plusieurs
    // maillons de la chaîne d'héritage — on ne le liste qu'une fois.
    const parCode = new Map<string, RoleProposable>();
    for (const r of regles) {
      if (parCode.has(r.roleCree)) {
        continue;
      }
      parCode.set(r.roleCree, {
        code: r.roleCree,
        libelle: r.cree.libelle,
        entite: r.cree.entiteCode,
        mode: r.mode === 'PROPOSITION' ? 'PROPOSITION' : 'CREATION_DIRECTE',
        scopeVerifie: r.scopeVerifie,
        roleValidateur: r.roleValidateur,
      });
    }

    return [...parCode.values()];
  }
}
