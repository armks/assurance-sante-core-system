import { randomUUID } from 'node:crypto';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreerOrganisationDto } from './dto/organisation.dto';
import { IdentityService } from './identity.service';

const ROLE_SUPERADMIN = 'SUPERADMIN_PRINCIPAL';

/**
 * OrganisationsService — onboarding des tenants racine par le superadministrateur
 * (interface /superadmin). Le provisioning du premier compte d'une organisation
 * passe ensuite par le module `invitations/`.
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
    });
  }

  async creer(user: AuthenticatedUser, dto: CreerOrganisationDto) {
    const ctx = await this.assertSuperadmin(user);

    const organisation = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organisation.create({
        data: {
          id: randomUUID(),
          nom: dto.nom,
          raisonSociale: dto.raisonSociale ?? null,
          type: dto.type,
          pays: dto.pays,
          devise: dto.devise ?? 'XOF',
        },
      });
      await tx.$executeRaw`
        SELECT log_audit(
          ${'CREATION_ORGANISATION'}::text,
          ${'organisations'}::text,
          ${org.id}::uuid,
          ${ctx.userId}::uuid,
          ${JSON.stringify({ nom: dto.nom, type: dto.type, pays: dto.pays })}::jsonb
        )`;
      return org;
    });

    return organisation;
  }

  private async assertSuperadmin(
    user: AuthenticatedUser,
  ): Promise<{ userId: string }> {
    const { profil, permissions } = await this.identity.getMe(user);
    const roleChain = permissions?.roleChain ?? [];
    if (!roleChain.includes(ROLE_SUPERADMIN)) {
      throw new ForbiddenException(
        'Action réservée au superadministrateur.',
      );
    }
    return { userId: profil.id };
  }
}
