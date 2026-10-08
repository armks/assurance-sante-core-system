import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { SousRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  IdentityMeResponse,
  NIVEAUX_ACCES,
  NiveauAcces,
  PermissionsResume,
  ProfilResume,
  ROLES_MEDICAUX,
} from './identity.types';

/**
 * IdentityService — source de vérité applicative pour l'identité de
 * l'utilisateur connecté : lecture du profil, de son sous-rôle, de la chaîne
 * d'héritage (rôle adjoint → rôle parent, v6 §3) et des permissions effectives,
 * via Prisma (connexion SQL directe à Postgres Supabase).
 *
 * Défense en profondeur : ce service applique ses propres vérifications
 * (profil non supprimé, rôle valide) EN PLUS des policies RLS Postgres.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Profil complet + permissions de l'utilisateur courant.
   * @param user contexte d'auth issu du JWT vérifié (SupabaseAuthGuard)
   */
  async getMe(user: AuthenticatedUser): Promise<IdentityMeResponse> {
    const profil = await this.prisma.profil.findFirst({
      where: { id: user.sub, deletedAt: null },
      include: {
        sousRole: true,
        organisation: { select: { nom: true, slug: true, statut: true, deletedAt: true } },
      },
    });

    if (!profil) {
      throw new NotFoundException(
        "Aucun profil actif n'est associé à ce compte.",
      );
    }

    // Organisation SUSPENDUE / ARCHIVEE / supprimée : accès coupé pour tous ses
    // comptes. Tous les services authentifiés passent par getMe → la coupure
    // vaut à CHAQUE requête (session déjà ouverte comprise), pas seulement à la
    // prochaine connexion. Les superadmins (sans organisation) ne sont pas
    // concernés. Doublé en base par prisma/sql/065 (accès PostgREST direct).
    if (profil.organisationId) {
      const org = profil.organisation;
      if (!org || org.deletedAt || org.statut !== 'ACTIVE') {
        const suspendue = org?.statut === 'SUSPENDUE' && !org.deletedAt;
        throw new ForbiddenException({
          statusCode: 403,
          code: suspendue ? 'ORGANISATION_SUSPENDUE' : 'ORGANISATION_INACTIVE',
          organisation: org?.nom ?? null,
          message: suspendue
            ? `L’accès de votre société « ${org.nom} » est suspendu. Contactez votre administrateur ou le support de la plateforme.`
            : 'Votre société n’est plus active sur la plateforme. Contactez le support de la plateforme.',
        });
      }
    }

    // Compte DÉSACTIVÉ (archivage de son établissement / pharmacie / société, ADR-007 lot 3) :
    // il le reste après un désarchivage, jusqu'à sa réactivation explicite par l'informatique.
    if (profil.desactiveLe) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'COMPTE_DESACTIVE',
        organisation: null,
        message: `Votre compte est désactivé${profil.desactiveMotif ? ` (${profil.desactiveMotif})` : ''}. Contactez le service informatique de votre assureur pour le rétablir.`,
      });
    }

    // Établissement / pharmacie / société ARCHIVÉ(E) ou supprimé(e) : les comptes qui y sont
    // rattachés ne peuvent plus agir (ADR-007, lot 3). Même point de passage que ci-dessus →
    // la coupure vaut à chaque requête, session ouverte comprise. Le désarchivage ne
    // réactive pas les comptes automatiquement : ils sont rétablis un à un par l'informatique
    // (retrait du rattachement ou suppression du compte).
    await this.assertPerimetreActif(profil);

    const profilResume: ProfilResume = {
      id: profil.id,
      organisationId: profil.organisationId,
      // Page d'accueil de l'organisation (/{slug}) — seulement si elle est
      // active : une page suspendue ou supprimée répondrait 404.
      organisationSlug:
        profil.organisation && profil.organisation.statut === 'ACTIVE' && !profil.organisation.deletedAt
          ? profil.organisation.slug
          : null,
      role: profil.role,
      libelleRole: profil.sousRole?.libelle ?? null,
      entite: profil.sousRole?.entiteCode ?? null,
      email: user.email,
      numeroOrdreMedecin: profil.numeroOrdreMedecin,
      methodeConnexion: profil.methodeConnexion,
      mfaActive: profil.mfaActive ?? false,
      societeId: profil.societeId,
      etablissementId: profil.etablissementId,
      pharmacieId: profil.pharmacieId,
      adherentId: profil.adherentId,
      createdAt: profil.createdAt,
      updatedAt: profil.updatedAt,
    };

    // Compte créé mais rôle pas encore assigné (provisioning en cours) :
    // on renvoie le profil sans permissions plutôt qu'une erreur.
    if (!profil.role || !profil.sousRole) {
      return { profil: profilResume, permissions: null };
    }

    // 25 sous-rôles au total : on les charge tous une fois pour résoudre la
    // chaîne d'héritage en mémoire sans requêtes récursives.
    const tousSousRoles = await this.prisma.sousRole.findMany();
    const parCode = new Map(tousSousRoles.map((r) => [r.code, r]));
    const chaine = this.resoudreChaineRoles(profil.sousRole, parCode);

    const permissions: PermissionsResume = {
      roleChain: chaine.map((r) => r.code),
      niveauAcces: this.niveauAccesEffectif(chaine),
      // `peutValider` reflète la valeur PROPRE au rôle assigné au profil
      // (`sous_roles.peut_valider` de `profil.role`), sans OR sur la chaîne
      // d'héritage : un rôle adjoint qui porte `peut_valider = false` ne
      // « peut pas valider », même si son rôle parent le peut. Le reste de la
      // chaîne (roleChain, niveauAcces, dashboardRoute) remonte l'héritage.
      peutValider: profil.sousRole.peutValider,
      dashboardRoute:
        chaine.find((r) => r.dashboardRoute)?.dashboardRoute ?? null,
      estRoleMedical: (ROLES_MEDICAUX as readonly string[]).includes(profil.role),
      scope: {
        organisationId: profil.organisationId,
        societeId: profil.societeId,
        etablissementId: profil.etablissementId,
        pharmacieId: profil.pharmacieId,
        adherentId: profil.adherentId,
      },
    };

    return { profil: profilResume, permissions };
  }

  private async assertPerimetreActif(profil: {
    etablissementId: string | null;
    pharmacieId: string | null;
    societeId: string | null;
  }): Promise<void> {
    const refuser = (nom: string, genre: string) => {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PERIMETRE_ARCHIVE',
        organisation: nom,
        message: `L’accès est coupé : ${genre} « ${nom} » est archivé(e). Contactez le service informatique de votre assureur.`,
      });
    };
    if (profil.etablissementId) {
      const e = await this.prisma.etablissementSante.findUnique({
        where: { id: profil.etablissementId },
        select: { nom: true, statut: true, deletedAt: true },
      });
      if (!e || e.deletedAt || e.statut === 'RESILIE') refuser(e?.nom ?? 'établissement', "l'établissement");
    }
    if (profil.pharmacieId) {
      const p = await this.prisma.pharmacie.findUnique({
        where: { id: profil.pharmacieId },
        select: { nom: true, statut: true, deletedAt: true },
      });
      if (!p || p.deletedAt || p.statut === 'RESILIEE') refuser(p?.nom ?? 'pharmacie', 'la pharmacie');
    }
    if (profil.societeId) {
      const s = await this.prisma.souscripteur.findUnique({
        where: { id: profil.societeId },
        select: { nom: true, statut: true, deletedAt: true },
      });
      if (!s || s.deletedAt || s.statut === 'ARCHIVE') refuser(s?.nom ?? 'société', 'la société');
    }
  }

  /** Rôle propre suivi de ses parents (role_parent_code), sans boucle infinie. */
  private resoudreChaineRoles(
    depart: SousRole,
    parCode: Map<string, SousRole>,
  ): SousRole[] {
    const chaine: SousRole[] = [];
    const vus = new Set<string>();
    let courant: SousRole | undefined = depart;

    while (courant && !vus.has(courant.code)) {
      vus.add(courant.code);
      chaine.push(courant);
      courant = courant.roleParentCode
        ? parCode.get(courant.roleParentCode)
        : undefined;
    }

    if (courant && vus.has(courant.code)) {
      this.logger.warn(
        `Cycle détecté dans la hiérarchie des sous-rôles à partir de « ${depart.code} ».`,
      );
    }

    return chaine;
  }

  private niveauAccesEffectif(chaine: SousRole[]): NiveauAcces {
    let indexMax = 0;
    for (const role of chaine) {
      const idx = NIVEAUX_ACCES.indexOf(role.niveauAcces as NiveauAcces);
      if (idx > indexMax) {
        indexMax = idx;
      }
    }
    return NIVEAUX_ACCES[indexMax];
  }
}
