import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
      include: { sousRole: true },
    });

    if (!profil) {
      throw new NotFoundException(
        "Aucun profil actif n'est associé à ce compte.",
      );
    }

    const profilResume: ProfilResume = {
      id: profil.id,
      organisationId: profil.organisationId,
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
