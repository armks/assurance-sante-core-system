import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CareEpisodeService } from '../care-episode/care-episode.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  GenererCodeConsultationDto,
  ValiderCodeConsultationDto,
} from './dto/preauthorization.dto';
import {
  ALPHABET_CODE,
  ContexteAppelant,
  LONGUEUR_CODE,
  ROLES_ADHERENT,
} from './preauthorization.types';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * PreauthorizationService — Code de Consultation (1er des 4 codes anti-fraude,
 * v8 §2).
 *
 * Flux : l'adhérent demande un code (vérif d'éligibilité via le
 * MoteurOuvertureDossier, SANS ouvrir le dossier) → le code lui est renvoyé
 * (APP/SMS ; ici dans la réponse API pour le test) → l'établissement le SAISIT →
 * `validerCodeConsultation` ouvre AUTOMATIQUEMENT le dossier de soins et marque
 * le code UTILISE_ETABLISSEMENT.
 *
 * C'est la SEULE voie d'ouverture d'un dossier : `CareEpisodeService.ouvrirDossier`
 * n'est plus exposé par aucune route (checklist v19).
 */
@Injectable()
export class PreauthorizationService {
  private readonly logger = new Logger(PreauthorizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly careEpisode: CareEpisodeService,
  ) {}

  // --- Génération (adhérent) ---------------------------------------

  async genererCodeConsultation(
    user: AuthenticatedUser,
    dto: GenererCodeConsultationDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.some((r) => (ROLES_ADHERENT as readonly string[]).includes(r))) {
      throw new ForbiddenException(
        'Seul un adhérent peut demander un code de consultation.',
      );
    }

    // Le patient : l'adhérent lui-même (ou un de ses bénéficiaires).
    const adherentId = dto.adherentId ?? ctx.adherentId ?? undefined;
    const beneficiaireId = dto.beneficiaireId ?? undefined;
    if (!adherentId && !beneficiaireId) {
      throw new BadRequestException(
        "Aucun patient identifiable : votre compte n'est pas rattaché à un adhérent.",
      );
    }
    if (adherentId && ctx.adherentId && adherentId !== ctx.adherentId) {
      throw new ForbiddenException(
        'Vous ne pouvez demander un code que pour vous-même.',
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
      throw new NotFoundException('Établissement inconnu ou hors de votre réseau.');
    }

    // Vérification d'éligibilité — MoteurOuvertureDossier, SANS ouvrir le dossier.
    const evaluation = await this.careEpisode.evaluerEligibilite(
      ctx.organisationId,
      {
        adherentId,
        beneficiaireId,
        etablissementId: dto.etablissementId,
        policeId: dto.policeId,
      },
    );
    if (evaluation.blocages.length > 0) {
      throw new ConflictException({
        message: "Impossible d'émettre un code : conditions d'éligibilité non réunies.",
        blocages: evaluation.blocages,
      });
    }

    const code = await this.genererCodeUnique();

    const cree = await this.prisma.$transaction(async (tx) => {
      const ligne = await tx.codeConsultation.create({
        data: {
          organisationId: ctx.organisationId,
          adherentId: adherentId ?? null,
          beneficiaireId: beneficiaireId ?? null,
          etablissementId: dto.etablissementId,
          policeId: dto.policeId,
          code,
          statut: 'EMIS',
        },
      });
      await this.audit(tx, ctx.userId, 'GENERATION_CODE_CONSULTATION', ligne.id, {
        etablissementId: dto.etablissementId,
        canal: ligne.canalEnvoi,
      });
      return ligne;
    });

    // Renvoyé À L'ADHÉRENT uniquement (jamais visible de l'établissement).
    return {
      id: cree.id,
      code: cree.code,
      statut: cree.statut,
      dateEmission: cree.dateEmission,
      dateExpiration: cree.dateExpiration,
      canalEnvoi: cree.canalEnvoi,
      etablissement: { id: etablissement.id, nom: etablissement.nom },
      message:
        "Présentez ce code à l'accueil de l'établissement. Il expire dans 48 heures et ne sert qu'une fois.",
    };
  }

  async confirmerPresence(user: AuthenticatedUser, codeId: string) {
    const ctx = await this.contexteAppelant(user);
    const code = await this.chargerCodeAdherent(ctx, codeId);
    if (code.statut !== 'EMIS') {
      throw new ConflictException(
        `Ce code ne peut plus être confirmé (statut : ${code.statut}).`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.codeConsultation.update({
        where: { id: codeId },
        data: { statut: 'CONFIRME_PATIENT' },
      });
      await this.audit(tx, ctx.userId, 'CONFIRMATION_CODE_CONSULTATION', codeId, null);
    });
    return { id: codeId, statut: 'CONFIRME_PATIENT' };
  }

  async annulerCode(user: AuthenticatedUser, codeId: string) {
    const ctx = await this.contexteAppelant(user);
    const code = await this.chargerCodeAdherent(ctx, codeId);
    if (['UTILISE_ETABLISSEMENT', 'ANNULE'].includes(code.statut)) {
      throw new ConflictException(
        `Ce code ne peut plus être annulé (statut : ${code.statut}).`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.codeConsultation.update({
        where: { id: codeId },
        data: { statut: 'ANNULE' },
      });
      await this.audit(tx, ctx.userId, 'ANNULATION_CODE_CONSULTATION', codeId, null);
    });
    return { id: codeId, statut: 'ANNULE' };
  }

  async listerMesCodes(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.adherentId) {
      return [];
    }
    return this.prisma.codeConsultation.findMany({
      where: { adherentId: ctx.adherentId },
      orderBy: { dateEmission: 'desc' },
      take: 50,
    });
  }

  // --- Validation (établissement) → ouverture du dossier -----------

  async validerCodeConsultation(
    user: AuthenticatedUser,
    dto: ValiderCodeConsultationDto,
  ) {
    const ctx = await this.contexteAppelant(user);

    const code = await this.prisma.codeConsultation.findUnique({
      where: { code: dto.code.toUpperCase() },
    });
    // Ne pas révéler la cause exacte de l'échec sur un code inconnu.
    if (!code || code.organisationId !== ctx.organisationId) {
      throw new NotFoundException('Code de consultation invalide.');
    }

    if (code.statut === 'UTILISE_ETABLISSEMENT') {
      throw new ConflictException(
        'Ce code a déjà été utilisé pour ouvrir un dossier de soins.',
      );
    }
    if (code.statut === 'ANNULE') {
      throw new GoneException('Ce code a été annulé par l’adhérent.');
    }
    if (code.statut === 'EXPIRE' || code.dateExpiration.getTime() < Date.now()) {
      if (code.statut !== 'EXPIRE') {
        await this.prisma.codeConsultation.update({
          where: { id: code.id },
          data: { statut: 'EXPIRE' },
        });
      }
      throw new GoneException('Ce code a expiré (validité : 48 heures).');
    }

    // Le code doit avoir été émis POUR CET établissement.
    if (code.etablissementId !== dto.etablissementId) {
      throw new ForbiddenException(
        "Ce code n'a pas été émis pour cet établissement.",
      );
    }

    // Ouverture automatique du dossier (SEULE voie). ouvrirDossier ré-évalue
    // l'éligibilité et lie/marque le code dans la même transaction.
    const dossier = await this.careEpisode.ouvrirDossier(
      user,
      {
        adherentId: code.adherentId ?? undefined,
        beneficiaireId: code.beneficiaireId ?? undefined,
        etablissementId: code.etablissementId,
        policeId: code.policeId,
        motifConsultation: dto.motifConsultation,
        diagnosticEntree: dto.diagnosticEntree,
        codeCim10: dto.codeCim10,
      },
      { codeConsultationId: code.id },
    );

    await this.prisma.$executeRaw`
      SELECT log_audit(
        ${'VALIDATION_CODE_CONSULTATION'}::text,
        ${'codes_consultation'}::text,
        ${code.id}::uuid,
        ${ctx.userId}::uuid,
        ${JSON.stringify({ dossierId: dossier.id, etablissementId: dto.etablissementId })}::jsonb
      )`;

    // On ne renvoie JAMAIS la valeur du code à l'établissement.
    return {
      code: { id: code.id, statut: 'UTILISE_ETABLISSEMENT' },
      dossier,
    };
  }

  // --- Helpers ----------------------------------------------------

  private async contexteAppelant(
    user: AuthenticatedUser,
  ): Promise<ContexteAppelant> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException(
        "Ce compte n'est rattaché à aucune organisation.",
      );
    }
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      role: profil.role,
      adherentId: profil.adherentId,
      roleChain: permissions?.roleChain ?? [],
    };
  }

  private async chargerCodeAdherent(ctx: ContexteAppelant, codeId: string) {
    const code = await this.prisma.codeConsultation.findFirst({
      where: { id: codeId, organisationId: ctx.organisationId },
    });
    if (!code) {
      throw new NotFoundException('Code de consultation introuvable.');
    }
    if (!ctx.adherentId || code.adherentId !== ctx.adherentId) {
      throw new ForbiddenException('Ce code ne vous appartient pas.');
    }
    return code;
  }

  /** Code cryptographiquement sûr (`crypto.randomInt`, jamais `Math.random`). */
  private tirerCode(): string {
    let s = '';
    for (let i = 0; i < LONGUEUR_CODE; i += 1) {
      s += ALPHABET_CODE[randomInt(ALPHABET_CODE.length)];
    }
    return s;
  }

  private async genererCodeUnique(): Promise<string> {
    for (let tentative = 0; tentative < 6; tentative += 1) {
      const candidat = this.tirerCode();
      const existe = await this.prisma.codeConsultation.findUnique({
        where: { code: candidat },
      });
      if (!existe) {
        return candidat;
      }
    }
    throw new ConflictException(
      "Impossible de générer un code unique — réessayez.",
    );
  }

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
          ${'codes_consultation'}::text,
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
