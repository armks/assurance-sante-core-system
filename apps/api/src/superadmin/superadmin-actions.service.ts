import { randomInt, randomUUID } from 'node:crypto';
import {
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
import { slugDepuisNom, slugLibre } from '../common/slug.util';
import { EmailService } from '../email/email.service';
import { IdentityService } from '../identity/identity.service';
import { InvitationsService } from '../invitations/invitations.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConfirmerActionDto,
  InitierCreationOrganisationDto,
  InitierProlongationDto,
  InitierSuspensionDto,
} from './dto/superadmin.dto';
import {
  ALPHABET_CODE_SA,
  ActionSuperadmin,
  LIBELLE_ACTION,
  LIMITES_PAR_PLAN,
  LONGUEUR_CODE_SA,
  ROLE_SUPERADMIN,
} from './superadmin.types';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * SuperadminActionsService — confirmation à deux temps des actions sensibles du
 * superadministrateur (v14 §5, PROMPT 22).
 *
 * `initier*` NE réalise PAS l'action : elle stocke le payload dans
 * `codes_validation_superadmin`, génère un code (crypto, 8 car., 15 min, usage
 * unique) et l'envoie par e-mail à `SUPERADMIN_EMAIL` (jamais en dur).
 * `confirmerAction(code)` exécute RÉELLEMENT l'action stockée.
 */
@Injectable()
export class SuperadminActionsService {
  private readonly logger = new Logger(SuperadminActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly invitations: InvitationsService,
    private readonly email: EmailService,
  ) {}

  // --- Initiation (envoi du code) -------------------------------------

  async initierCreationOrganisation(
    user: AuthenticatedUser,
    dto: InitierCreationOrganisationDto,
  ) {
    await this.assertSuperadmin(user);

    const plan = dto.plan ?? 'STARTER';
    const role = dto.premierCompteRole ?? 'ASSUREUR_INFORMATIQUE';
    const codeAssureur = dto.codeAssureur?.trim() || null;
    if (codeAssureur && (await this.prisma.organisation.count({ where: { codeAssureur } })) > 0) {
      throw new ConflictException(`Le code assureur ${codeAssureur} est déjà attribué à une autre société.`);
    }
    const payload = {
      nom: dto.nom,
      codeAssureur,
      raisonSociale: dto.raisonSociale ?? null,
      type: dto.type,
      pays: dto.pays,
      devise: dto.devise ?? 'XOF',
      plan,
      limiteAdherents:
        dto.limiteAdherents ?? LIMITES_PAR_PLAN[plan].limiteAdherents,
      limiteAppelsApiMois:
        dto.limiteAppelsApiMois ?? LIMITES_PAR_PLAN[plan].limiteAppelsApiMois,
      dateFin: dto.dateFin ?? this.dansUnAn(),
      premierCompteEmail: dto.premierCompteEmail,
      premierCompteRole: role,
    };
    const resume =
      `Créer l'organisation « ${dto.nom} » (${dto.type}, ${dto.pays}${codeAssureur ? `, code assureur ${codeAssureur}` : ''}) — plan ${plan} — ` +
      `et inviter ${dto.premierCompteEmail} comme ${role}.`;

    return this.initier(user, 'CREATION_ORGANISATION', payload, resume);
  }

  async initierSuspensionOrganisation(
    user: AuthenticatedUser,
    organisationId: string,
    dto: InitierSuspensionDto,
  ) {
    await this.assertSuperadmin(user);
    const org = await this.chargerOrganisation(organisationId);

    const payload = { organisationId, motif: dto.motif ?? null };
    const resume =
      `Suspendre l'organisation « ${org.nom} » (accès coupé pour tous ses comptes).` +
      (dto.motif ? ` Motif : ${dto.motif}.` : '');

    return this.initier(user, 'SUSPENSION_ORGANISATION', payload, resume);
  }

  async initierProlongationOrganisation(
    user: AuthenticatedUser,
    organisationId: string,
    dto: InitierProlongationDto,
  ) {
    await this.assertSuperadmin(user);
    const org = await this.chargerOrganisation(organisationId);
    const licence = await this.prisma.licenceOrganisation.findUnique({
      where: { organisationId },
    });
    if (!licence) {
      throw new NotFoundException(
        "Cette organisation n'a pas de licence à prolonger.",
      );
    }

    const payload = {
      organisationId,
      nouvelleDateFin: dto.nouvelleDateFin,
      motif: dto.motif ?? null,
    };
    const resume =
      `Prolonger la licence de « ${org.nom} » jusqu'au ` +
      `${dto.nouvelleDateFin.slice(0, 10)}.`;

    return this.initier(user, 'PROLONGATION_ORGANISATION', payload, resume);
  }

  private async initier(
    user: AuthenticatedUser,
    action: ActionSuperadmin,
    payload: Record<string, unknown>,
    resume: string,
  ) {
    const { userId } = await this.assertSuperadmin(user);
    const code = await this.genererCodeUnique();

    const ligne = await this.prisma.$transaction(async (tx) => {
      const l = await tx.codeValidationSuperadmin.create({
        data: {
          action,
          payload: payload as Prisma.InputJsonValue,
          code,
          statut: 'EMIS',
        },
      });
      await this.audit(tx, userId, 'INITIATION_ACTION_SUPERADMIN', l.id, {
        action,
        resume,
      });
      return l;
    });

    const destinataire = process.env.SUPERADMIN_EMAIL;
    let emailEnvoye = false;
    if (!destinataire) {
      this.logger.error(
        'SUPERADMIN_EMAIL non défini — impossible d\'envoyer le code de validation.',
      );
    } else {
      const res = await this.email.envoyerEmail(
        destinataire,
        `[Assurance Santé] Code de confirmation — ${LIBELLE_ACTION[action]}`,
        [
          `Une action sensible a été initiée sur la plateforme :`,
          ``,
          `  ${resume}`,
          ``,
          `Votre code de confirmation : ${code}`,
          ``,
          `Ce code est valable 15 minutes et ne peut servir qu'une fois.`,
          `Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail`,
          `(l'action ne sera pas exécutée sans le code).`,
        ].join('\n'),
      );
      emailEnvoye = res.envoye;
    }

    return {
      actionId: ligne.id,
      action,
      resume,
      dateExpiration: ligne.dateExpiration,
      emailEnvoye,
      message: emailEnvoye
        ? `Un code de confirmation a été envoyé à l'adresse du superadministrateur.`
        : `Action enregistrée mais l'e-mail n'a pas pu être envoyé — vérifiez la configuration.`,
    };
  }

  // --- Confirmation (exécution réelle) ------------------------------

  async confirmerAction(user: AuthenticatedUser, dto: ConfirmerActionDto) {
    const { userId } = await this.assertSuperadmin(user);

    const ligne = await this.prisma.codeValidationSuperadmin.findUnique({
      where: { code: dto.code.toUpperCase() },
    });
    if (!ligne) {
      throw new NotFoundException('Code de confirmation invalide.');
    }
    if (ligne.statut === 'CONFIRME') {
      throw new ConflictException('Cette action a déjà été confirmée.');
    }
    if (ligne.statut === 'ANNULE') {
      throw new GoneException('Cette action a été annulée.');
    }
    if (
      ligne.statut === 'EXPIRE' ||
      ligne.dateExpiration.getTime() < Date.now()
    ) {
      if (ligne.statut !== 'EXPIRE') {
        await this.prisma.codeValidationSuperadmin.update({
          where: { id: ligne.id },
          data: { statut: 'EXPIRE' },
        });
      }
      throw new GoneException(
        'Ce code de confirmation a expiré (validité : 15 minutes).',
      );
    }

    const payload = ligne.payload as Record<string, unknown>;
    switch (ligne.action) {
      case 'CREATION_ORGANISATION':
        return this.executerCreationOrganisation(user, userId, ligne.id, payload);
      case 'SUSPENSION_ORGANISATION':
        return this.executerSuspension(userId, ligne.id, payload);
      case 'PROLONGATION_ORGANISATION':
        return this.executerProlongation(userId, ligne.id, payload);
      default:
        throw new InternalServerErrorException('Action inconnue.');
    }
  }

  private async executerCreationOrganisation(
    user: AuthenticatedUser,
    userId: string,
    codeId: string,
    p: Record<string, unknown>,
  ) {
    // Chemin de la page d'accueil dédiée (/{slug}) : dérivé du nom, rendu
    // unique (-2, -3…) ; modifiable ensuite par SUPERADMIN_PRINCIPAL.
    const slug = await slugLibre(slugDepuisNom(String(p.nom)), async (s) =>
      (await this.prisma.organisation.count({ where: { slug: s, deletedAt: null } })) > 0,
    );
    const organisation = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organisation.create({
        data: {
          id: randomUUID(),
          nom: p.nom as string,
          slug,
          ...(p.codeAssureur ? { codeAssureur: p.codeAssureur as string } : {}),
          raisonSociale: (p.raisonSociale as string | null) ?? null,
          type: p.type as string,
          pays: p.pays as string,
          devise: (p.devise as string) ?? 'XOF',
        },
      });
      await tx.licenceOrganisation.create({
        data: {
          organisationId: org.id,
          plan: p.plan as string,
          limiteAdherents: (p.limiteAdherents as number) ?? null,
          limiteAppelsApiMois: (p.limiteAppelsApiMois as number) ?? null,
          dateFin: p.dateFin ? new Date(p.dateFin as string) : null,
          statut: 'ACTIVE',
        },
      });
      await tx.codeValidationSuperadmin.update({
        where: { id: codeId },
        data: { statut: 'CONFIRME' },
      });
      await this.audit(tx, userId, 'CREATION_ORGANISATION', org.id, {
        nom: String(p.nom),
        slug,
        type: String(p.type),
        plan: String(p.plan),
        viaCodeValidation: codeId,
      });
      await this.audit(
        tx,
        userId,
        'CONFIRMATION_ACTION_SUPERADMIN',
        codeId,
        { action: 'CREATION_ORGANISATION', organisationId: org.id },
        'codes_validation_superadmin',
      );
      return org;
    });

    // Invitation du premier compte — hors transaction (appel API Admin Supabase).
    let invitation: unknown;
    try {
      invitation = await this.invitations.creerInvitation(user, {
        email: p.premierCompteEmail as string,
        rolePropose: p.premierCompteRole as string,
        organisationId: organisation.id,
      });
    } catch (e) {
      this.logger.error(
        `Organisation ${organisation.id} créée mais l'invitation du premier compte a échoué : ${
          e instanceof Error ? e.message : 'erreur inconnue'
        }`,
      );
      invitation = {
        erreur:
          "L'organisation a été créée, mais l'invitation du premier compte a échoué. Renvoyez-la manuellement.",
      };
    }

    return { organisation, invitation };
  }

  private async executerSuspension(
    userId: string,
    codeId: string,
    p: Record<string, unknown>,
  ) {
    const organisationId = p.organisationId as string;
    await this.chargerOrganisation(organisationId);

    const organisation = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organisation.update({
        where: { id: organisationId },
        data: { statut: 'SUSPENDUE' },
      });
      await tx.licenceOrganisation.updateMany({
        where: { organisationId },
        data: { statut: 'SUSPENDUE' },
      });
      await tx.codeValidationSuperadmin.update({
        where: { id: codeId },
        data: { statut: 'CONFIRME' },
      });
      await this.audit(tx, userId, 'SUSPENSION_ORGANISATION', organisationId, {
        motif: p.motif ? String(p.motif) : null,
        viaCodeValidation: codeId,
      });
      await this.audit(
        tx,
        userId,
        'CONFIRMATION_ACTION_SUPERADMIN',
        codeId,
        { action: 'SUSPENSION_ORGANISATION', organisationId },
        'codes_validation_superadmin',
      );
      return org;
    });

    return { organisation };
  }

  private async executerProlongation(
    userId: string,
    codeId: string,
    p: Record<string, unknown>,
  ) {
    const organisationId = p.organisationId as string;
    const nouvelleDateFin = new Date(p.nouvelleDateFin as string);
    const licence = await this.prisma.licenceOrganisation.findUnique({
      where: { organisationId },
    });
    if (!licence) {
      throw new NotFoundException("Licence introuvable pour cette organisation.");
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const l = await tx.licenceOrganisation.update({
        where: { organisationId },
        data: {
          dateFin: nouvelleDateFin,
          statut: licence.statut === 'EXPIREE' ? 'ACTIVE' : licence.statut,
        },
      });
      // une organisation SUSPENDUE le reste ; une organisation ARCHIVEE/EXPIREE
      // qu'on prolonge redevient ACTIVE.
      if (licence.statut === 'EXPIREE') {
        await tx.organisation.updateMany({
          where: { id: organisationId, statut: { not: 'SUSPENDUE' } },
          data: { statut: 'ACTIVE' },
        });
      }
      await tx.codeValidationSuperadmin.update({
        where: { id: codeId },
        data: { statut: 'CONFIRME' },
      });
      await this.audit(tx, userId, 'PROLONGATION_ORGANISATION', organisationId, {
        nouvelleDateFin: String(p.nouvelleDateFin),
        viaCodeValidation: codeId,
      });
      await this.audit(
        tx,
        userId,
        'CONFIRMATION_ACTION_SUPERADMIN',
        codeId,
        { action: 'PROLONGATION_ORGANISATION', organisationId },
        'codes_validation_superadmin',
      );
      return l;
    });

    return { licence: maj };
  }

  // --- Listing / annulation --------------------------------------

  async listerActionsEnAttente(user: AuthenticatedUser) {
    await this.assertSuperadmin(user);
    const lignes = await this.prisma.codeValidationSuperadmin.findMany({
      where: { statut: 'EMIS', dateExpiration: { gt: new Date() } },
      orderBy: { dateEmission: 'desc' },
      take: 30,
    });
    return lignes.map((l) => ({
      id: l.id,
      action: l.action,
      resume: this.resumeDepuisPayload(l.action, l.payload as Record<string, unknown>),
      dateEmission: l.dateEmission,
      dateExpiration: l.dateExpiration,
    }));
  }

  async annulerAction(user: AuthenticatedUser, actionId: string) {
    const { userId } = await this.assertSuperadmin(user);
    const ligne = await this.prisma.codeValidationSuperadmin.findUnique({
      where: { id: actionId },
    });
    if (!ligne) {
      throw new NotFoundException('Action introuvable.');
    }
    if (ligne.statut !== 'EMIS') {
      throw new ConflictException(
        `Cette action ne peut plus être annulée (statut : ${ligne.statut}).`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.codeValidationSuperadmin.update({
        where: { id: actionId },
        data: { statut: 'ANNULE' },
      });
      await this.audit(
        tx,
        userId,
        'ANNULATION_ACTION_SUPERADMIN',
        actionId,
        { action: ligne.action },
        'codes_validation_superadmin',
      );
    });
    return { id: actionId, statut: 'ANNULE' };
  }

  // --- Helpers -------------------------------------------------

  private async assertSuperadmin(
    user: AuthenticatedUser,
  ): Promise<{ userId: string }> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!(permissions?.roleChain ?? []).includes(ROLE_SUPERADMIN)) {
      throw new ForbiddenException('Action réservée au superadministrateur.');
    }
    return { userId: profil.id };
  }

  private async chargerOrganisation(id: string) {
    const org = await this.prisma.organisation.findFirst({
      where: { id, deletedAt: null },
    });
    if (!org) {
      throw new NotFoundException('Organisation introuvable.');
    }
    return org;
  }

  private tirerCode(): string {
    let s = '';
    for (let i = 0; i < LONGUEUR_CODE_SA; i += 1) {
      s += ALPHABET_CODE_SA[randomInt(ALPHABET_CODE_SA.length)];
    }
    return s;
  }

  private async genererCodeUnique(): Promise<string> {
    for (let t = 0; t < 6; t += 1) {
      const c = this.tirerCode();
      const existe = await this.prisma.codeValidationSuperadmin.findUnique({
        where: { code: c },
      });
      if (!existe) return c;
    }
    throw new InternalServerErrorException(
      'Impossible de générer un code de confirmation unique.',
    );
  }

  private dansUnAn(): string {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  }

  private resumeDepuisPayload(
    action: string,
    p: Record<string, unknown>,
  ): string {
    if (action === 'CREATION_ORGANISATION') {
      return `Créer « ${p.nom} » (${p.type}) — plan ${p.plan} — premier compte ${p.premierCompteEmail}.`;
    }
    if (action === 'SUSPENSION_ORGANISATION') {
      return `Suspendre l'organisation ${p.organisationId as string}.`;
    }
    if (action === 'PROLONGATION_ORGANISATION') {
      return `Prolonger la licence jusqu'au ${(p.nouvelleDateFin as string)?.slice(0, 10)}.`;
    }
    return action;
  }

  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
    tableCible = 'organisations',
  ): Promise<void> {
    try {
      await db.$executeRaw`
        SELECT log_audit(
          ${action}::text,
          ${tableCible}::text,
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
