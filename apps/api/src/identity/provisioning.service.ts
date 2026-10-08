import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from './identity.service';
import { CompteOrganisation, RoleProposable } from './provisioning.types';

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

  /**
   * Comptes de l'organisation de l'appelant (page /utilisateurs). Réservé aux
   * rôles d'administration de l'assureur (informatique / direction). L'e-mail
   * provient de `auth.users` — non modélisé côté Prisma, lu en SQL brut.
   */
  async listerComptesOrganisation(
    user: AuthenticatedUser,
  ): Promise<CompteOrganisation[]> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException(
        "Votre compte n'est rattaché à aucune organisation.",
      );
    }
    const roleChain = permissions?.roleChain ?? [];
    const autorise = ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_DIRECTION'].some((r) =>
      roleChain.includes(r),
    );
    if (!autorise) {
      throw new ForbiddenException(
        'Rôle insuffisant pour consulter les comptes de l’organisation.',
      );
    }

    return this.prisma.$queryRaw<CompteOrganisation[]>`
      SELECT p.id,
             p.role,
             sr.libelle       AS "libelleRole",
             u.email          AS email,
             p.created_at     AS "createdAt",
             p.desactive_le   AS "desactiveLe",
             p.desactive_motif AS "desactiveMotif",
             p.statut         AS statut,
             p.revoque_le     AS "revoqueLe",
             p.revoque_motif  AS "revoqueMotif",
             sr.entite_code   AS "entiteRole",
             p.etablissement_id AS "etablissementId",
             p.pharmacie_id   AS "pharmacieId",
             p.societe_id     AS "societeId"
      FROM profils p
      JOIN auth.users u ON u.id = p.id
      LEFT JOIN sous_roles sr ON sr.code = p.role
      WHERE p.organisation_id = ${profil.organisationId}::uuid
        AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC`;
  }
}
