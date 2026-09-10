import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from './identity.service';

const ROLE_SUPERADMIN = 'SUPERADMIN_PRINCIPAL';

/**
 * OrganisationsService — lecture des tenants racine par le superadministrateur
 * (interface /superadmin). La CRÉATION d'une organisation ne passe plus par ici :
 * elle se fait en deux temps via `SuperadminActionsService` (code par e-mail,
 * PROMPT 22) — il n'existe plus de route de création directe.
 */
@Injectable()
export class OrganisationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  async lister(user: AuthenticatedUser) {
    await this.assertSuperadmin(user);
    return this.prisma.organisation.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { licence: true },
    });
  }

  private async assertSuperadmin(
    user: AuthenticatedUser,
  ): Promise<{ userId: string }> {
    const { profil, permissions } = await this.identity.getMe(user);
    const roleChain = permissions?.roleChain ?? [];
    if (!roleChain.includes(ROLE_SUPERADMIN)) {
      throw new ForbiddenException('Action réservée au superadministrateur.');
    }
    return { userId: profil.id };
  }
}
