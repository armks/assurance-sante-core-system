import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { DependancesService } from '../dependances/dependances.service';
import { IdentityService } from '../identity/identity.service';
import { NIVEAUX_ACCES } from '../identity/identity.types';
import { SupabaseAdminService } from '../invitations/supabase-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { CIBLES_PERIMETRE, type CiblePerimetre } from './dto/comptes.dto';

type Db = PrismaService | Prisma.TransactionClient;

/** Rôle d'administration des comptes (miroir de GESTION_UTILISATEURS du registre). */
const ROLE_ADMIN_COMPTES = 'ASSUREUR_INFORMATIQUE';

export interface CompteDesactive {
  id: string;
  email: string | null;
  role: string | null;
  motif: string | null;
}

/**
 * ComptesService — cycle de vie des COMPTES UTILISATEURS d'une organisation (ADR-007, lot 4) :
 * révoquer, réactiver, changer le rôle, supprimer, réactiver un périmètre désarchivé.
 *
 * Règles transverses :
 *  - un compte révoqué n'est jamais supprimé : statut REVOQUE en base (relu à CHAQUE requête par
 *    le garde et par `getMe`, refusé par la RLS) + blocage Supabase Auth + sessions supprimées ;
 *  - le serveur décide : chaque action passe par `DependancesService.assertPossible` (auto-
 *    révocation, dernier administrateur, niveau supérieur, périmètre) → 403 / 409 + refus tracé ;
 *  - succès : écriture + `log_audit()` dans UNE transaction ; appels Supabase APRÈS validation.
 */
@Injectable()
export class ComptesService {
  private readonly logger = new Logger(ComptesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly dependances: DependancesService,
    private readonly admin: SupabaseAdminService,
  ) {}

  // --- Révoquer ------------------------------------------------------------------------

  async revoquer(user: AuthenticatedUser, id: string, motif?: string) {
    const ctx = await this.contexte(user);
    const cible = await this.charger(ctx.organisationId, id);
    await this.dependances.assertPossible(user, 'utilisateur', id, 'archiver');

    await this.prisma.$transaction(async (tx) => {
      await tx.profil.update({
        where: { id },
        data: { statut: 'REVOQUE', revoqueLe: new Date(), revoquePar: ctx.userId, revoqueMotif: motif ?? null },
      });
      await this.audit(tx, ctx.userId, 'REVOCATION_COMPTE', id, { role: cible.role, motif: motif ?? null });
    });

    // Après validation : sessions supprimées + compte Auth bloqué (jamais supprimé).
    const sessions = await this.invaliderSessions(id);
    const blocageAuth = await this.admin.definirBlocage(id, true);
    return { id, statut: 'REVOQUE', blocageAuth, sessionsInvalidees: sessions };
  }

  // --- Réactiver -----------------------------------------------------------------------

  async reactiver(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexte(user);
    const cible = await this.charger(ctx.organisationId, id);
    await this.dependances.assertPossible(user, 'utilisateur', id, 'desarchiver');

    const archive = await this.structureArchivee(cible);
    if (archive) {
      throw new ConflictException(`Réactivation impossible : ${archive} est encore archivé(e). Désarchivez-le(la) d'abord.`);
    }

    const etait = cible.statut === 'REVOQUE' ? 'REVOQUE' : 'DESACTIVE';
    await this.prisma.$transaction(async (tx) => {
      await tx.profil.update({
        where: { id },
        data: { statut: 'ACTIF', revoqueLe: null, revoquePar: null, revoqueMotif: null, desactiveLe: null, desactiveMotif: null },
      });
      await this.audit(tx, ctx.userId, 'REACTIVATION_COMPTE', id, { etait, motifPrecedent: cible.revoqueMotif ?? cible.desactiveMotif ?? null });
    });
    const blocageAuth = await this.admin.definirBlocage(id, false);
    return { id, statut: 'ACTIF', blocageAuth };
  }

  // --- Changer le rôle -----------------------------------------------------------------

  /**
   * Seulement vers un rôle PERMIS par `regles_provisioning` pour l'appelant, de la même entité
   * (le périmètre — établissement, pharmacie, société — ne change pas), jamais au-dessus du niveau
   * de l'appelant. Ancien et nouveau rôle tracés. Effet immédiat : `getMe` relit le rôle en base à
   * chaque requête, il n'est jamais porté par le jeton.
   */
  async changerRole(user: AuthenticatedUser, id: string, nouveauRole: string) {
    const ctx = await this.contexte(user);
    const cible = await this.charger(ctx.organisationId, id);
    await this.dependances.assertPossible(user, 'utilisateur', id, 'modifier');

    if (cible.role === nouveauRole) {
      throw new ConflictException('Ce compte a déjà ce rôle.');
    }
    const [ancien, nouveau] = await Promise.all([
      cible.role ? this.prisma.sousRole.findUnique({ where: { code: cible.role } }) : null,
      this.prisma.sousRole.findUnique({ where: { code: nouveauRole } }),
    ]);
    if (!nouveau) throw new BadRequestException(`Rôle inconnu : ${nouveauRole}.`);
    const regle = await this.prisma.regleProvisioning.findFirst({
      where: { roleCree: nouveauRole, deletedAt: null, roleCreateur: { in: ctx.roleChain } },
    });
    if (!regle) {
      throw new ForbiddenException(`Votre rôle ne permet pas d'attribuer le rôle « ${nouveauRole} » (règles de provisioning).`);
    }
    if (ancien && ancien.entiteCode !== nouveau.entiteCode) {
      throw new ConflictException(
        `Changement de rôle impossible : « ${nouveauRole} » appartient à une autre entité (${nouveau.entiteCode}) que le rôle actuel (${ancien.entiteCode}). Invitez un nouveau compte.`,
      );
    }
    if (NIVEAUX_ACCES.indexOf(nouveau.niveauAcces as (typeof NIVEAUX_ACCES)[number]) > NIVEAUX_ACCES.indexOf(ctx.niveauAcces as (typeof NIVEAUX_ACCES)[number])) {
      throw new ForbiddenException('Vous ne pouvez pas attribuer un rôle d’un niveau supérieur au vôtre.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.profil.update({ where: { id }, data: { role: nouveauRole } });
      await this.audit(tx, ctx.userId, 'CHANGEMENT_ROLE', id, { ancienRole: cible.role, nouveauRole });
    });
    return { id, ancienRole: cible.role, role: nouveauRole };
  }

  // --- Supprimer -----------------------------------------------------------------------

  /** Seulement sans aucune référence ni ligne d'audit (registre). Compte Auth supprimé APRÈS validation. */
  async supprimer(user: AuthenticatedUser, id: string): Promise<void> {
    const ctx = await this.contexte(user);
    const cible = await this.charger(ctx.organisationId, id);
    await this.dependances.assertPossible(user, 'utilisateur', id, 'supprimer');

    await this.prisma.$transaction(async (tx) => {
      await tx.profil.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit(tx, ctx.userId, 'SUPPRESSION_COMPTE', id, { role: cible.role });
    });
    await this.invaliderSessions(id);
    await this.admin.supprimerUtilisateur(id);
  }

  // --- Périmètre désarchivé : réactivation groupée -----------------------------------

  /** Comptes désactivés (par un archivage) d'un périmètre — pour la confirmation « Tout réactiver ». */
  async desactivesDuPerimetre(user: AuthenticatedUser, cible: CiblePerimetre, id: string): Promise<CompteDesactive[]> {
    const ctx = await this.contexte(user);
    await this.assertPerimetre(ctx.organisationId, cible, id);
    return this.listerDesactives(this.prisma, ctx.organisationId, cible, id);
  }

  /**
   * « Tout réactiver » : rétablit en une transaction tous les comptes DÉSACTIVÉS d'un périmètre
   * désarchivé. Refusé tant que le périmètre est archivé. Les comptes RÉVOQUÉS à la main ne sont
   * jamais touchés (révocation ≠ désactivation).
   */
  async reactiverPerimetre(user: AuthenticatedUser, cible: CiblePerimetre, id: string) {
    const ctx = await this.contexte(user);
    const nom = await this.assertPerimetre(ctx.organisationId, cible, id);
    if (nom.archive) {
      throw new ConflictException(`Réactivation impossible : ${nom.designation} « ${nom.nom} » est encore archivé(e). Désarchivez-le(la) d'abord.`);
    }
    const reactives = await this.prisma.$transaction(async (tx) => {
      const comptes = await this.listerDesactives(tx, ctx.organisationId, cible, id);
      if (comptes.length === 0) {
        throw new ConflictException(`Aucun compte désactivé à réactiver pour ${nom.designation} « ${nom.nom} ».`);
      }
      await tx.profil.updateMany({
        where: { id: { in: comptes.map((c) => c.id) } },
        data: { desactiveLe: null, desactiveMotif: null },
      });
      for (const c of comptes) {
        await this.audit(tx, ctx.userId, 'REACTIVATION_COMPTE', c.id, { etait: 'DESACTIVE', groupee: true, perimetre: `${cible}:${id}` });
      }
      return comptes;
    });
    return { reactives };
  }

  // --- Helpers -------------------------------------------------------------------------

  private async contexte(user: AuthenticatedUser) {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    }
    const roleChain = permissions?.roleChain ?? [];
    if (!roleChain.includes(ROLE_ADMIN_COMPTES)) {
      throw new ForbiddenException('La gestion des comptes est réservée à l’Assurance Informatique.');
    }
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      roleChain,
      niveauAcces: permissions?.niveauAcces ?? 'LECTURE_SEULE',
    };
  }

  /** 404 (sans rien révéler) hors de l'organisation de l'appelant. */
  private async charger(organisationId: string, id: string) {
    const p = await this.prisma.profil.findFirst({ where: { id, organisationId, deletedAt: null } });
    if (!p) throw new NotFoundException('Compte introuvable.');
    return p;
  }

  private async structureArchivee(p: { etablissementId: string | null; pharmacieId: string | null; societeId: string | null }): Promise<string | null> {
    if (p.etablissementId) {
      const e = await this.prisma.etablissementSante.findUnique({ where: { id: p.etablissementId }, select: { nom: true, statut: true, deletedAt: true } });
      if (!e || e.deletedAt || e.statut === 'RESILIE') return `l'établissement « ${e?.nom ?? 'inconnu'} »`;
    }
    if (p.pharmacieId) {
      const ph = await this.prisma.pharmacie.findUnique({ where: { id: p.pharmacieId }, select: { nom: true, statut: true, deletedAt: true } });
      if (!ph || ph.deletedAt || ph.statut === 'RESILIEE') return `la pharmacie « ${ph?.nom ?? 'inconnue'} »`;
    }
    if (p.societeId) {
      const s = await this.prisma.souscripteur.findUnique({ where: { id: p.societeId }, select: { nom: true, statut: true, deletedAt: true } });
      if (!s || s.deletedAt || s.statut === 'ARCHIVE') return `la société « ${s?.nom ?? 'inconnue'} »`;
    }
    return null;
  }

  private async assertPerimetre(organisationId: string, cible: CiblePerimetre, id: string) {
    if (!(CIBLES_PERIMETRE as readonly string[]).includes(cible)) {
      throw new BadRequestException('Périmètre inconnu.');
    }
    if (cible === 'etablissement') {
      const e = await this.prisma.etablissementSante.findFirst({ where: { id, organisationId, deletedAt: null }, select: { nom: true, statut: true } });
      if (!e) throw new NotFoundException('Établissement introuvable.');
      return { nom: e.nom, archive: e.statut === 'RESILIE', designation: "l'établissement" };
    }
    if (cible === 'pharmacie') {
      const p = await this.prisma.pharmacie.findFirst({ where: { id, organisationId, deletedAt: null }, select: { nom: true, statut: true } });
      if (!p) throw new NotFoundException('Pharmacie introuvable.');
      return { nom: p.nom, archive: p.statut === 'RESILIEE', designation: 'la pharmacie' };
    }
    const s = await this.prisma.souscripteur.findFirst({ where: { id, organisationId, deletedAt: null }, select: { nom: true, statut: true } });
    if (!s) throw new NotFoundException('Société introuvable.');
    return { nom: s.nom, archive: s.statut === 'ARCHIVE', designation: 'la société' };
  }

  private async listerDesactives(db: Db, organisationId: string, cible: CiblePerimetre, id: string): Promise<CompteDesactive[]> {
    const colonne = cible === 'etablissement' ? Prisma.sql`p.etablissement_id` : cible === 'pharmacie' ? Prisma.sql`p.pharmacie_id` : Prisma.sql`p.societe_id`;
    return db.$queryRaw<CompteDesactive[]>`
      SELECT p.id, u.email AS email, p.role AS role, p.desactive_motif AS motif
      FROM profils p
      LEFT JOIN auth.users u ON u.id = p.id
      WHERE p.organisation_id = ${organisationId}::uuid
        AND ${colonne} = ${id}::uuid
        AND p.deleted_at IS NULL
        AND p.statut = 'ACTIF'
        AND p.desactive_le IS NOT NULL
      ORDER BY u.email`;
  }

  /** Supprime les sessions Auth du compte (jetons de renouvellement) — meilleur effort. */
  private async invaliderSessions(authUserId: string): Promise<boolean> {
    try {
      await this.prisma.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${authUserId}::uuid`;
      return true;
    } catch (error) {
      this.logger.warn(`Sessions Auth de ${authUserId} non supprimées : ${error instanceof Error ? error.message : 'erreur inconnue'}`);
      return false;
    }
  }

  private async audit(db: Db, userId: string, action: string, enregistrementId: string, details: Prisma.InputJsonValue | null): Promise<void> {
    try {
      await db.$executeRaw`
        SELECT log_audit(
          ${action}::text,
          ${'profils'}::text,
          ${enregistrementId}::uuid,
          ${userId}::uuid,
          ${details === null ? null : JSON.stringify(details)}::jsonb
        )`;
    } catch (error) {
      this.logger.error(`Échec log_audit(${action}, ${enregistrementId}) : ${error instanceof Error ? error.message : 'erreur inconnue'}`);
      throw error;
    }
  }
}
