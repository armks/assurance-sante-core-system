import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
             p.desactive_motif AS "desactiveMotif"
      FROM profils p
      JOIN auth.users u ON u.id = p.id
      LEFT JOIN sous_roles sr ON sr.code = p.role
      WHERE p.organisation_id = ${profil.organisationId}::uuid
        AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC`;
  }

  /**
   * Rétablit un compte désactivé par un archivage. Réservé à l'informatique ; refusé tant
   * que l'établissement, la pharmacie ou la société auquel le compte est rattaché reste
   * archivé. Le désarchivage d'une structure ne rétablit JAMAIS ses comptes à sa place.
   */
  async reactiverCompte(user: AuthenticatedUser, compteId: string) {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId || !(permissions?.roleChain ?? []).includes('ASSUREUR_INFORMATIQUE')) {
      throw new ForbiddenException('La réactivation des comptes est réservée à l’Assurance Informatique.');
    }
    const cible = await this.prisma.profil.findFirst({
      where: { id: compteId, organisationId: profil.organisationId, deletedAt: null },
    });
    if (!cible) throw new NotFoundException('Compte introuvable.');
    if (!cible.desactiveLe) throw new ConflictException('Ce compte n’est pas désactivé.');

    const archive = async (): Promise<string | null> => {
      if (cible.etablissementId) {
        const e = await this.prisma.etablissementSante.findUnique({ where: { id: cible.etablissementId }, select: { nom: true, statut: true, deletedAt: true } });
        if (!e || e.deletedAt || e.statut === 'RESILIE') return `l'établissement « ${e?.nom ?? 'inconnu'} »`;
      }
      if (cible.pharmacieId) {
        const p = await this.prisma.pharmacie.findUnique({ where: { id: cible.pharmacieId }, select: { nom: true, statut: true, deletedAt: true } });
        if (!p || p.deletedAt || p.statut === 'RESILIEE') return `la pharmacie « ${p?.nom ?? 'inconnue'} »`;
      }
      if (cible.societeId) {
        const s = await this.prisma.souscripteur.findUnique({ where: { id: cible.societeId }, select: { nom: true, statut: true, deletedAt: true } });
        if (!s || s.deletedAt || s.statut === 'ARCHIVE') return `la société « ${s?.nom ?? 'inconnue'} »`;
      }
      return null;
    };
    const bloque = await archive();
    if (bloque) {
      throw new ConflictException(`Réactivation impossible : ${bloque} est encore archivé(e). Désarchivez-le(la) d'abord.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.profil.update({ where: { id: compteId }, data: { desactiveLe: null, desactiveMotif: null } });
      await tx.$executeRaw`
        SELECT log_audit(
          'REACTIVATION_COMPTE'::text, 'profils'::text, ${compteId}::uuid, ${profil.id}::uuid,
          ${JSON.stringify({ motifPrecedent: cible.desactiveMotif })}::jsonb
        )`;
    });
    return { id: compteId, desactiveLe: null };
  }
}
