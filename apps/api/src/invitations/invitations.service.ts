import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AccepterInvitationDto,
  CreerInvitationDto,
} from './dto/invitations.dto';
import { SupabaseAdminService } from './supabase-admin.service';
import {
  ContexteAppelant,
  ENTITE_SUPERADMIN,
  ScopeInvitation,
} from './invitations.types';

type Db = PrismaService | Prisma.TransactionClient;

const WEB_URL = (process.env.WEB_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

/**
 * InvitationsService — flux d'invitation sécurisé (v5 §3, PROMPT 6).
 *
 * Enchaînement :
 *  1. `creerInvitation` vérifie `regles_provisioning` AVANT tout appel externe.
 *     - mode CREATION_DIRECTE → appelle l'API Admin Supabase (inviteUserByEmail),
 *       crée la ligne `invitations` en statut EN_ATTENTE.
 *     - mode PROPOSITION → crée la ligne en EN_ATTENTE_VALIDATION_INFORMATIQUE,
 *       aucun appel Supabase tant que le validateur n'a pas tranché.
 *  2. `validerProposition` (réservé au `roleValidateur`) déclenche l'invitation.
 *  3. `accepterInvitation` (public) : l'invité pose SON mot de passe — jamais
 *     généré ni stocké côté serveur — puis le profil applicatif est créé.
 *
 * Défense en profondeur : ce service applique ses propres contrôles en plus des
 * policies RLS `peut_inviter_role` (prisma/sql/008).
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly admin: SupabaseAdminService,
  ) {}

  // --- Création / proposition ------------------------------------------

  async creerInvitation(user: AuthenticatedUser, dto: CreerInvitationDto) {
    const ctx = await this.contexteAppelant(user);

    // 1. Règle de provisioning — AVANT tout appel à l'API Admin Supabase.
    const regle = await this.prisma.regleProvisioning.findFirst({
      where: {
        roleCree: dto.rolePropose,
        deletedAt: null,
        roleCreateur: { in: ctx.roleChain },
      },
    });
    if (!regle) {
      throw new ForbiddenException(
        `Votre rôle ne permet pas d'inviter un compte « ${dto.rolePropose} ».`,
      );
    }

    const scope = await this.resoudreScope(regle, ctx, dto);
    await this.assertPasDejaCompte(dto.email);

    const token = this.genererToken();
    const modeProposition = regle.mode === 'PROPOSITION';

    // 2a. PROPOSITION : on n'invite pas encore — on attend la validation.
    if (modeProposition) {
      const inv = await this.prisma.$transaction(async (tx) => {
        const i = await tx.invitation.create({
          data: {
            email: dto.email,
            telephone: dto.telephone ?? null,
            rolePropose: dto.rolePropose,
            ...scope,
            invitePar: ctx.userId,
            token,
            statut: 'EN_ATTENTE_VALIDATION_INFORMATIQUE',
            mode: 'PROPOSITION',
            roleValidateur: regle.roleValidateur,
          },
        });
        await this.audit(tx, ctx.userId, 'PROPOSITION_INVITATION', i.id, {
          email: dto.email,
          role: dto.rolePropose,
          validateur: regle.roleValidateur,
        });
        return i;
      });
      return this.presenter(inv, { avecToken: true });
    }

    // 2b. CREATION_DIRECTE : la règle est vérifiée → on appelle l'API Admin.
    const { authUserId, emailEnvoye } = await this.admin.inviterUtilisateur(
      dto.email,
      `${WEB_URL}/accepter-invitation/${token}`,
      { invitation_token: token, role_propose: dto.rolePropose },
    );

    const inv = await this.prisma.$transaction(async (tx) => {
      const i = await tx.invitation.create({
        data: {
          email: dto.email,
          telephone: dto.telephone ?? null,
          rolePropose: dto.rolePropose,
          ...scope,
          invitePar: ctx.userId,
          token,
          statut: 'EN_ATTENTE',
          mode: 'CREATION_DIRECTE',
          authUserId,
          emailEnvoye,
        },
      });
      await this.audit(tx, ctx.userId, 'CREATION_INVITATION', i.id, {
        email: dto.email,
        role: dto.rolePropose,
        emailEnvoye,
      });
      return i;
    });

    return this.presenter(inv, { avecToken: true });
  }

  // --- Validation d'une proposition -----------------------------------

  async validerProposition(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    const inv = await this.charger(id);

    if (inv.statut !== 'EN_ATTENTE_VALIDATION_INFORMATIQUE') {
      throw new ConflictException(
        `Cette invitation n'est pas en attente de validation (statut : ${inv.statut}).`,
      );
    }
    if (!inv.roleValidateur || !ctx.roleChain.includes(inv.roleValidateur)) {
      throw new ForbiddenException(
        `Seul le rôle « ${inv.roleValidateur ?? '—'} » peut valider cette proposition.`,
      );
    }
    if (
      inv.organisationId &&
      ctx.organisationId &&
      inv.organisationId !== ctx.organisationId
    ) {
      throw new ForbiddenException('Proposition hors de votre organisation.');
    }

    const { authUserId, emailEnvoye } = await this.admin.inviterUtilisateur(
      inv.email,
      `${WEB_URL}/accepter-invitation/${inv.token}`,
      { invitation_token: inv.token, role_propose: inv.rolePropose },
    );

    const maj = await this.prisma.$transaction(async (tx) => {
      const i = await tx.invitation.update({
        where: { id },
        data: { statut: 'EN_ATTENTE', authUserId, emailEnvoye },
      });
      await this.audit(tx, ctx.userId, 'VALIDATION_PROPOSITION_INVITATION', id, {
        email: inv.email,
        role: inv.rolePropose,
        emailEnvoye,
      });
      return i;
    });

    return this.presenter(maj, { avecToken: true });
  }

  async rejeterProposition(
    user: AuthenticatedUser,
    id: string,
    motif?: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    const inv = await this.charger(id);

    if (inv.statut !== 'EN_ATTENTE_VALIDATION_INFORMATIQUE') {
      throw new ConflictException(
        `Cette invitation n'est pas en attente de validation (statut : ${inv.statut}).`,
      );
    }
    if (!inv.roleValidateur || !ctx.roleChain.includes(inv.roleValidateur)) {
      throw new ForbiddenException(
        `Seul le rôle « ${inv.roleValidateur ?? '—'} » peut rejeter cette proposition.`,
      );
    }
    // Même contrôle que `validerProposition` : sans lui, un validateur d'une
    // autre organisation pouvait rejeter cette proposition avec son seul id.
    if (
      inv.organisationId &&
      ctx.organisationId &&
      inv.organisationId !== ctx.organisationId
    ) {
      throw new ForbiddenException('Proposition hors de votre organisation.');
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const i = await tx.invitation.update({
        where: { id },
        data: { statut: 'REJETEE', motifRejet: motif ?? null },
      });
      await this.audit(tx, ctx.userId, 'REJET_PROPOSITION_INVITATION', id, {
        email: inv.email,
        motif: motif ?? null,
      });
      return i;
    });

    return this.presenter(maj, { avecToken: false });
  }

  async revoquer(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    const inv = await this.charger(id);

    if (!this.estGestionnaire(ctx, inv)) {
      throw new ForbiddenException(
        'Seul l’émetteur de l’invitation (ou son validateur) peut la révoquer.',
      );
    }
    if (['ACCEPTEE', 'REJETEE', 'REVOQUEE'].includes(inv.statut)) {
      throw new ConflictException(
        `Invitation déjà close (statut : ${inv.statut}).`,
      );
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const i = await tx.invitation.update({
        where: { id },
        data: { statut: 'REVOQUEE' },
      });
      await this.audit(tx, ctx.userId, 'REVOCATION_INVITATION', id, {
        email: inv.email,
      });
      return i;
    });

    if (inv.authUserId) {
      await this.admin.supprimerUtilisateur(inv.authUserId);
    }
    return this.presenter(maj, { avecToken: false });
  }

  /**
   * Retente l'envoi réel de l'e-mail pour une invitation déjà émise
   * (`EN_ATTENTE`, compte Supabase déjà créé) — corrige la visibilité d'un
   * échec silencieux (ex. rate-limit SMTP par défaut Supabase, confirmé en
   * conditions réelles : `429 over_email_send_rate_limit`). Un seul essai
   * explicite par appel — jamais de boucle de retentative automatique ; le
   * résultat (succès ou nouvel échec) est immédiatement reflété dans
   * `emailEnvoye`, jamais masqué.
   */
  async renvoyerEmail(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    const inv = await this.charger(id);

    if (!this.estGestionnaire(ctx, inv)) {
      throw new ForbiddenException(
        "Seul l'émetteur de l'invitation (ou son validateur) peut renvoyer l'e-mail.",
      );
    }
    if (inv.statut !== 'EN_ATTENTE') {
      throw new ConflictException(
        `Impossible de renvoyer l'e-mail : invitation au statut ${inv.statut}.`,
      );
    }
    if (!inv.authUserId) {
      throw new InternalServerErrorException(
        'Invitation incomplète : compte Supabase manquant.',
      );
    }

    const { emailEnvoye } = await this.admin.inviterUtilisateur(
      inv.email,
      `${WEB_URL}/accepter-invitation/${inv.token}`,
      { invitation_token: inv.token, role_propose: inv.rolePropose },
    );

    const maj = await this.prisma.$transaction(async (tx) => {
      const i = await tx.invitation.update({
        where: { id },
        data: { emailEnvoye },
      });
      await this.audit(tx, ctx.userId, 'RENVOI_EMAIL_INVITATION', id, {
        email: inv.email,
        emailEnvoye,
      });
      return i;
    });

    return this.presenter(maj, { avecToken: true });
  }

  // --- Listing --------------------------------------------------------

  async listerMesInvitations(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);

    const invitations = await this.prisma.invitation.findMany({
      where: {
        deletedAt: null,
        OR: [
          { invitePar: ctx.userId },
          // Propositions dont l'appelant est le rôle validateur — y compris
          // APRÈS validation : c'est la validation qui déclenche l'e-mail, le
          // validateur doit donc voir un échec d'envoi (« Email non envoyé »)
          // et pouvoir le renvoyer.
          {
            mode: 'PROPOSITION',
            roleValidateur: { in: ctx.roleChain },
            organisationId: ctx.organisationId,
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    // `avecToken: true` : nécessaire pour l'action "Copier le lien" (secours
    // manuel si l'e-mail échoue) — même donnée déjà retournée UNE FOIS au
    // même appelant à la création/validation, pas une nouvelle exposition.
    return invitations.map((inv) => this.presenter(inv, { avecToken: true }));
  }

  /** Contexte public affiché sur /accepter-invitation/[token] — aucun secret. */
  async consulterParToken(token: string) {
    const inv = await this.prisma.invitation.findFirst({
      where: { token, deletedAt: null },
    });
    if (!inv) {
      throw new NotFoundException('Invitation introuvable.');
    }
    const role = await this.prisma.sousRole.findUnique({
      where: { code: inv.rolePropose },
    });
    const expiree = inv.expireLe.getTime() < Date.now();
    return {
      email: inv.email,
      rolePropose: inv.rolePropose,
      libelleRole: role?.libelle ?? inv.rolePropose,
      statut: inv.statut,
      expiree,
      // exploitable directement par le formulaire : l'invitation est prête si
      // elle a été envoyée (EN_ATTENTE) et n'est pas expirée.
      acceptable: inv.statut === 'EN_ATTENTE' && !expiree,
    };
  }

  // --- Acceptation (public) ------------------------------------------

  async accepterInvitation(dto: AccepterInvitationDto) {
    const inv = await this.prisma.invitation.findFirst({
      where: { token: dto.token, deletedAt: null },
    });
    if (!inv) {
      throw new NotFoundException('Invitation introuvable.');
    }
    if (inv.statut === 'ACCEPTEE') {
      throw new ConflictException('Cette invitation a déjà été acceptée.');
    }
    if (inv.statut === 'EN_ATTENTE_VALIDATION_INFORMATIQUE') {
      throw new ConflictException(
        "Cette invitation attend encore la validation d'un administrateur.",
      );
    }
    if (['REJETEE', 'REVOQUEE'].includes(inv.statut)) {
      throw new GoneException(
        `Cette invitation a été ${inv.statut === 'REJETEE' ? 'rejetée' : 'révoquée'}.`,
      );
    }
    if (inv.statut === 'EXPIREE' || inv.expireLe.getTime() < Date.now()) {
      if (inv.statut !== 'EXPIREE') {
        await this.prisma.invitation.update({
          where: { id: inv.id },
          data: { statut: 'EXPIREE' },
        });
      }
      throw new GoneException('Cette invitation a expiré.');
    }
    if (!inv.authUserId) {
      throw new InternalServerErrorException(
        'Invitation incomplète : compte Supabase manquant.',
      );
    }

    const profilExistant = await this.prisma.profil.findUnique({
      where: { id: inv.authUserId },
    });
    if (profilExistant) {
      throw new ConflictException('Un profil existe déjà pour ce compte.');
    }

    // 1. L'invité pose SON mot de passe (transmis tel quel à l'API Admin,
    //    jamais journalisé ni stocké).
    await this.admin.definirMotDePasse(inv.authUserId, dto.motDePasse);

    // 2. Création du profil applicatif + clôture de l'invitation.
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.profil.create({
          data: {
            id: inv.authUserId!,
            role: inv.rolePropose,
            organisationId: inv.organisationId,
            societeId: inv.societeId,
            etablissementId: inv.etablissementId,
            pharmacieId: inv.pharmacieId,
            adherentId: inv.adherentId,
            methodeConnexion: 'EMAIL_MDP',
          },
        });
        await tx.invitation.update({
          where: { id: inv.id },
          data: { statut: 'ACCEPTEE', accepteLe: new Date() },
        });
        await this.audit(tx, inv.authUserId!, 'ACCEPTATION_INVITATION', inv.id, {
          role: inv.rolePropose,
        });
      });
    } catch (error) {
      this.logger.error(
        `Finalisation de l'invitation ${inv.id} échouée : ${
          error instanceof Error ? error.message : 'erreur inconnue'
        }`,
      );
      throw new InternalServerErrorException(
        "L'activation du compte a échoué. Contactez votre administrateur.",
      );
    }

    const role = await this.prisma.sousRole.findUnique({
      where: { code: inv.rolePropose },
    });
    return {
      ok: true,
      email: inv.email,
      role: inv.rolePropose,
      dashboardRoute: role?.dashboardRoute ?? '/dashboard',
    };
  }

  // --- Helpers -------------------------------------------------------

  private async contexteAppelant(
    user: AuthenticatedUser,
  ): Promise<ContexteAppelant> {
    const { profil, permissions } = await this.identity.getMe(user);
    return {
      userId: profil.id,
      role: profil.role,
      entite: profil.entite,
      organisationId: profil.organisationId,
      pharmacieId: profil.pharmacieId,
      societeId: profil.societeId,
      roleChain: permissions?.roleChain ?? [],
    };
  }

  /**
   * Calcule le périmètre du compte à créer d'après le `scope_verifie` de la
   * règle — jamais d'après une valeur libre fournie par l'appelant (sauf
   * l'organisation cible d'un superadmin, qui n'a pas de scope propre).
   */
  private async resoudreScope(
    regle: { scopeVerifie: string | null },
    ctx: ContexteAppelant,
    dto: CreerInvitationDto,
  ): Promise<ScopeInvitation> {
    const scope: ScopeInvitation = {
      organisationId: null,
      societeId: null,
      etablissementId: null,
      pharmacieId: null,
      adherentId: null,
    };

    if (regle.scopeVerifie === 'organisation_id') {
      if (!ctx.organisationId) {
        throw new ForbiddenException(
          "Votre compte n'est rattaché à aucune organisation.",
        );
      }
      scope.organisationId = ctx.organisationId;

      // Rôles rattachés à un établissement/pharmacie/souscripteur précis : le
      // champ est obligatoire, et — même règle que pour `adherentId` plus bas
      // — jamais de confiance dans un ID fourni sans vérifier qu'il appartient
      // bien à l'organisation de l'appelant (pas de rattachement croisé).
      if (dto.rolePropose.startsWith('CENTRE_MEDICAL_')) {
        if (!dto.etablissementId) {
          throw new BadRequestException(
            'Un établissement doit être sélectionné pour ce rôle.',
          );
        }
        const etablissement = await this.prisma.etablissementSante.findFirst({
          where: {
            id: dto.etablissementId,
            organisationId: ctx.organisationId,
            deletedAt: null,
          },
        });
        if (!etablissement) {
          throw new NotFoundException(
            'Établissement introuvable dans votre organisation.',
          );
        }
        scope.etablissementId = etablissement.id;
      } else if (dto.rolePropose.startsWith('PHARMACIE_')) {
        if (!dto.pharmacieId) {
          throw new BadRequestException(
            'Une pharmacie doit être sélectionnée pour ce rôle.',
          );
        }
        const pharmacie = await this.prisma.pharmacie.findFirst({
          where: {
            id: dto.pharmacieId,
            organisationId: ctx.organisationId,
            deletedAt: null,
          },
        });
        if (!pharmacie) {
          throw new NotFoundException(
            'Pharmacie introuvable dans votre organisation.',
          );
        }
        scope.pharmacieId = pharmacie.id;
      } else if (dto.rolePropose === 'SOCIETE_ADMINISTRATION') {
        if (!dto.societeId) {
          throw new BadRequestException(
            'Un souscripteur doit être sélectionné pour ce rôle.',
          );
        }
        const souscripteur = await this.prisma.souscripteur.findFirst({
          where: {
            id: dto.societeId,
            organisationId: ctx.organisationId,
            deletedAt: null,
          },
        });
        if (!souscripteur) {
          throw new NotFoundException(
            'Souscripteur introuvable dans votre organisation.',
          );
        }
        scope.societeId = souscripteur.id;
      } else {
        scope.societeId = dto.societeId ?? null;
        scope.etablissementId = dto.etablissementId ?? null;
        scope.pharmacieId = dto.pharmacieId ?? null;
      }

      scope.adherentId = dto.adherentId ?? null;
      return scope;
    }

    if (regle.scopeVerifie === 'pharmacie_id') {
      if (!ctx.pharmacieId) {
        throw new ForbiddenException(
          "Votre compte n'est rattaché à aucune pharmacie.",
        );
      }
      scope.organisationId = ctx.organisationId;
      scope.pharmacieId = ctx.pharmacieId;
      return scope;
    }

    if (regle.scopeVerifie === 'societe_id') {
      if (!ctx.societeId) {
        throw new ForbiddenException(
          "Votre compte n'est rattaché à aucune société.",
        );
      }
      // L'adhérent invité doit réellement appartenir à CETTE société — jamais
      // faire confiance à un `adherentId` fourni par l'appelant sans le
      // revérifier contre son propre périmètre (même famille de contrôle que
      // les fuites inter-établissement/pharmacie déjà corrigées ailleurs).
      if (dto.adherentId) {
        const adherent = await this.prisma.adherent.findFirst({
          where: {
            id: dto.adherentId,
            souscripteurId: ctx.societeId,
            deletedAt: null,
          },
        });
        if (!adherent) {
          throw new NotFoundException(
            "Adhérent introuvable pour votre société.",
          );
        }
      }
      scope.organisationId = ctx.organisationId;
      scope.societeId = ctx.societeId;
      scope.adherentId = dto.adherentId ?? null;
      return scope;
    }

    // scope_verifie IS NULL → superadmin. Le compte créé peut viser une
    // organisation précise (obligatoire sauf pour un rôle SUPERADMIN).
    const role = await this.prisma.sousRole.findUnique({
      where: { code: dto.rolePropose },
    });
    if (role?.entiteCode === ENTITE_SUPERADMIN) {
      return scope;
    }
    if (!dto.organisationId) {
      throw new BadRequestException(
        'organisationId est requis pour ce rôle.',
      );
    }
    const org = await this.prisma.organisation.findFirst({
      where: { id: dto.organisationId, deletedAt: null },
    });
    if (!org) {
      throw new NotFoundException('Organisation cible introuvable.');
    }
    scope.organisationId = org.id;
    return scope;
  }

  private async assertPasDejaCompte(email: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count
      FROM auth.users u
      JOIN profils p ON p.id = u.id AND p.deleted_at IS NULL
      WHERE lower(u.email) = lower(${email})`;
    if ((rows[0]?.count ?? 0n) > 0n) {
      throw new ConflictException(
        'Un compte actif existe déjà pour cette adresse e-mail.',
      );
    }
  }

  private genererToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Émetteur de l'invitation, ou — pour une PROPOSITION — le rôle validateur de
   * la même organisation (c'est lui qui a déclenché l'envoi de l'e-mail).
   */
  private estGestionnaire(
    ctx: { userId: string; organisationId: string | null; roleChain: string[] },
    inv: {
      invitePar: string;
      mode: string;
      roleValidateur: string | null;
      organisationId: string | null;
    },
  ): boolean {
    if (inv.invitePar === ctx.userId) return true;
    return (
      inv.mode === 'PROPOSITION' &&
      !!inv.roleValidateur &&
      ctx.roleChain.includes(inv.roleValidateur) &&
      !!ctx.organisationId &&
      inv.organisationId === ctx.organisationId
    );
  }

  private async charger(id: string) {
    const inv = await this.prisma.invitation.findFirst({
      where: { id, deletedAt: null },
    });
    if (!inv) {
      throw new NotFoundException('Invitation introuvable.');
    }
    return inv;
  }

  private presenter(
    inv: {
      id: string;
      email: string;
      telephone: string | null;
      rolePropose: string;
      organisationId: string | null;
      statut: string;
      mode: string;
      roleValidateur: string | null;
      authUserId?: string | null;
      token: string;
      emailEnvoye?: boolean | null;
      expireLe: Date;
      accepteLe: Date | null;
      createdAt: Date;
    },
    opts: { avecToken: boolean },
  ) {
    return {
      id: inv.id,
      email: inv.email,
      telephone: inv.telephone,
      rolePropose: inv.rolePropose,
      organisationId: inv.organisationId,
      statut: inv.statut,
      mode: inv.mode,
      roleValidateur: inv.roleValidateur,
      // NULL = aucun envoi réel encore tenté (proposition en attente, ou
      // ligne historique antérieure à ce suivi) — distinct de `false`.
      emailEnvoye: inv.emailEnvoye ?? null,
      expireLe: inv.expireLe,
      accepteLe: inv.accepteLe,
      createdAt: inv.createdAt,
      ...(opts.avecToken
        ? { token: inv.token, lienAcceptation: `/accepter-invitation/${inv.token}` }
        : {}),
    };
  }

  /** Écriture d'audit — toujours via `log_audit()` (v9 §1.6). */
  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
  ): Promise<void> {
    try {
      await db.$executeRaw`
        SELECT log_audit(
          ${action}::text,
          ${'invitations'}::text,
          ${enregistrementId}::uuid,
          ${userId}::uuid,
          ${details === null ? null : JSON.stringify(details)}::jsonb
        )`;
    } catch (error) {
      this.logger.error(
        `Échec log_audit(${action}, ${enregistrementId}) : ${
          error instanceof Error ? error.message : 'erreur inconnue'
        }`,
      );
      throw error;
    }
  }
}
