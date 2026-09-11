import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CalculerPrimeDto,
  EvaluerQuestionnaireDto,
  SoumettreQuestionnaireDto,
} from './dto/underwriting.dto';
import {
  ContexteAppelant,
  ROLE_MEDECIN_SOUSCRIPTEUR,
  ROLES_TARIFICATION_INDIVIDUELLE,
} from './underwriting.types';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * UnderwritingService — questionnaire médical à la souscription individuelle et
 * tarification au risque (v4 §3.1, v9 §1.4, v10 §3).
 *
 * SÉPARATION STRICTE : lecture ET décision du questionnaire réservées à
 * `ASSUREUR_MEDECIN_SOUSCRIPTEUR`. `ASSUREUR_MEDECIN_CONSEIL` — qui liquide les
 * sinistres — n'a AUCUN accès à cette table, pour éviter le conflit d'intérêt
 * juge/partie. Vérifié ici EN PLUS des policies RLS (`profil_a_role`,
 * prisma/sql/007).
 *
 * Le souscripteur individuel voit son propre questionnaire ; la décision ne lui
 * est visible qu'une fois RENDUE (contrainte CHECK : decision ⟺ date_decision).
 */
@Injectable()
export class UnderwritingService {
  private readonly logger = new Logger(UnderwritingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  // --- Questionnaire -------------------------------------------------

  async soumettreQuestionnaire(
    user: AuthenticatedUser,
    dto: SoumettreQuestionnaireDto,
  ) {
    const ctx = await this.contexteAppelant(user);

    const souscripteur = await this.prisma.souscripteur.findFirst({
      where: {
        id: dto.souscripteurId,
        organisationId: ctx.organisationId,
        deletedAt: null,
      },
    });
    if (!souscripteur) {
      throw new NotFoundException('Souscripteur introuvable.');
    }
    if (souscripteur.type !== 'INDIVIDUEL') {
      throw new BadRequestException(
        'Un questionnaire médical ne concerne que les souscripteurs de type INDIVIDUEL.',
      );
    }

    // le souscripteur lui-même OU le médecin souscripteur
    if (
      !this.estLeSouscripteur(ctx, dto.souscripteurId) &&
      !ctx.roleChain.includes(ROLE_MEDECIN_SOUSCRIPTEUR)
    ) {
      throw new ForbiddenException(
        'Seul le souscripteur concerné (ou le médecin souscripteur) peut soumettre ce questionnaire.',
      );
    }

    const existe = await this.prisma.questionnaireMedical.findFirst({
      where: { souscripteurId: dto.souscripteurId, deletedAt: null },
    });
    if (existe) {
      throw new ConflictException(
        'Un questionnaire médical existe déjà pour ce souscripteur.',
      );
    }

    const id = await this.prisma.$transaction(async (tx) => {
      const q = await tx.questionnaireMedical.create({
        data: {
          souscripteurId: dto.souscripteurId,
          reponses: (dto.reponses ?? {}) as Prisma.InputJsonValue,
          antecedentsDeclares: dto.antecedentsDeclares ?? [],
          dateSoumission: new Date(),
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'SOUMISSION_QUESTIONNAIRE',
        q.id,
        { souscripteurId: dto.souscripteurId },
        'questionnaires_medicaux',
      );
      return q.id;
    });

    return this.chargerQuestionnaire(ctx, id);
  }

  async evaluerQuestionnaire(
    user: AuthenticatedUser,
    id: string,
    dto: EvaluerQuestionnaireDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    // GARDE CENTRALE : réservé à ASSUREUR_MEDECIN_SOUSCRIPTEUR
    this.assertMedecinSouscripteur(ctx);

    const q = await this.chargerQuestionnaireBrut(ctx.organisationId, id);
    if (q.decision !== null) {
      throw new ConflictException(
        `Ce questionnaire a déjà été évalué (${q.decision}).`,
      );
    }

    if (dto.decision === 'ACCEPTE_SURPRIME' && !(dto.surprimePourcent && dto.surprimePourcent > 0)) {
      throw new BadRequestException(
        'ACCEPTE_SURPRIME exige un surprimePourcent strictement positif.',
      );
    }
    if (
      dto.decision === 'ACCEPTE_AVEC_EXCLUSION' &&
      !(dto.exclusionsSpecifiques && dto.exclusionsSpecifiques.length > 0)
    ) {
      throw new BadRequestException(
        'ACCEPTE_AVEC_EXCLUSION exige au moins une exclusion spécifique.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.questionnaireMedical.update({
        where: { id },
        data: {
          decision: dto.decision,
          exclusionsSpecifiques:
            dto.decision === 'ACCEPTE_AVEC_EXCLUSION'
              ? (dto.exclusionsSpecifiques ?? [])
              : [],
          surprimePourcent:
            dto.decision === 'ACCEPTE_SURPRIME'
              ? new Decimal(dto.surprimePourcent ?? 0).toFixed(2)
              : '0.00',
          validePar: ctx.userId,
          dateDecision: new Date(),
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'DECISION_QUESTIONNAIRE',
        id,
        {
          decision: dto.decision,
          surprimePourcent: dto.surprimePourcent ?? 0,
          exclusions: dto.exclusionsSpecifiques?.length ?? 0,
        },
        'questionnaires_medicaux',
      );
    });

    return this.chargerQuestionnaire(ctx, id);
  }

  async obtenirQuestionnaire(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    return this.chargerQuestionnaire(ctx, id);
  }

  async listerQuestionnaires(
    user: AuthenticatedUser,
    filtres: { decision?: string; souscripteurId?: string },
  ) {
    const ctx = await this.contexteAppelant(user);

    if (ctx.roleChain.includes(ROLE_MEDECIN_SOUSCRIPTEUR)) {
      return this.prisma.questionnaireMedical.findMany({
        where: {
          deletedAt: null,
          souscripteur: { organisationId: ctx.organisationId },
          ...(filtres.decision ? { decision: filtres.decision } : {}),
          ...(filtres.souscripteurId
            ? { souscripteurId: filtres.souscripteurId }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: {
          souscripteur: { select: { id: true, nom: true, type: true } },
        },
      });
    }

    // le souscripteur ne voit que le sien
    if (ctx.societeId) {
      return this.prisma.questionnaireMedical.findMany({
        where: { souscripteurId: ctx.societeId, deletedAt: null },
        include: {
          souscripteur: { select: { id: true, nom: true, type: true } },
        },
      });
    }

    throw new ForbiddenException(
      "Accès au questionnaire médical réservé à ASSUREUR_MEDECIN_SOUSCRIPTEUR (ASSUREUR_MEDECIN_CONSEIL n'y a aucun accès) et au souscripteur concerné.",
    );
  }

  // --- Tarification individuelle ---------------------------------

  async calculerPrime(user: AuthenticatedUser, dto: CalculerPrimeDto) {
    const ctx = await this.contexteAppelant(user);
    const autorise = ctx.roleChain.some((code) =>
      (ROLES_TARIFICATION_INDIVIDUELLE as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        'Rôle insuffisant pour produire une tarification individuelle.',
      );
    }

    const police = await this.prisma.police.findFirst({
      where: {
        id: dto.policeId,
        organisationId: ctx.organisationId,
        deletedAt: null,
      },
    });
    if (!police) {
      throw new NotFoundException('Police introuvable.');
    }

    const questionnaire = await this.chargerQuestionnaireBrut(
      ctx.organisationId,
      dto.questionnaireMedicalId,
    );
    if (questionnaire.souscripteurId !== police.souscripteurId) {
      throw new BadRequestException(
        "Le questionnaire n'appartient pas au souscripteur de la police.",
      );
    }
    if (questionnaire.decision === null) {
      throw new BadRequestException(
        "Le questionnaire médical n'a pas encore été évalué.",
      );
    }
    if (questionnaire.decision === 'REFUSE') {
      throw new BadRequestException(
        'Souscription refusée par le médecin souscripteur — pas de tarification.',
      );
    }

    const grille = await this.prisma.grilleTarifaire.findFirst({
      where: {
        produitId: police.produitId,
        souscripteurId: null,
        deletedAt: null,
        trancheAgeMin: { lte: dto.ageASubscription },
        trancheAgeMax: { gte: dto.ageASubscription },
      },
    });
    if (!grille) {
      throw new NotFoundException(
        `Aucune grille tarifaire standard pour le produit et l'âge ${dto.ageASubscription}.`,
      );
    }

    const primeBase = new Decimal(grille.montantMensuel.toString());
    const surprimeMedicale = primeBase
      .mul(questionnaire.surprimePourcent.toString())
      .div(100)
      .toDecimalPlaces(2);

    const id = await this.prisma.$transaction(async (tx) => {
      const tarif = await tx.tarificationIndividuelle.create({
        data: {
          policeId: dto.policeId,
          questionnaireMedicalId: dto.questionnaireMedicalId,
          ageASubscription: dto.ageASubscription,
          primeBase: primeBase.toFixed(2),
          surprimeMedicale: surprimeMedicale.toFixed(2),
          // prime_finale : colonne GENERATED — ne pas écrire
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CALCUL_PRIME_INDIVIDUELLE',
        tarif.id,
        {
          policeId: dto.policeId,
          primeBase: primeBase.toFixed(2),
          surprimeMedicale: surprimeMedicale.toFixed(2),
          decision: questionnaire.decision,
        },
        'tarification_individuelle',
      );
      return tarif.id;
    });

    return this.prisma.tarificationIndividuelle.findUnique({ where: { id } });
  }

  /** Tarifications individuelles déjà calculées de l'organisation (lecture). */
  async listerTarifications(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    const autorise = ctx.roleChain.some((code) =>
      (ROLES_TARIFICATION_INDIVIDUELLE as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        'Rôle insuffisant pour consulter les tarifications individuelles.',
      );
    }
    return this.prisma.tarificationIndividuelle.findMany({
      where: {
        police: { organisationId: ctx.organisationId, deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        police: {
          select: {
            numeroPolice: true,
            souscripteur: { select: { nom: true } },
          },
        },
        questionnaire: { select: { decision: true } },
      },
    });
  }

  // --- Autorisation / chargement -------------------------------

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
      entite: profil.entite,
      societeId: profil.societeId,
      roleChain: permissions?.roleChain ?? [],
    };
  }

  private assertMedecinSouscripteur(ctx: ContexteAppelant): void {
    if (!ctx.roleChain.includes(ROLE_MEDECIN_SOUSCRIPTEUR)) {
      throw new ForbiddenException(
        "Réservé exclusivement à ASSUREUR_MEDECIN_SOUSCRIPTEUR. ASSUREUR_MEDECIN_CONSEIL n'a aucun accès au questionnaire médical (séparation stricte, v10 §3).",
      );
    }
  }

  private estLeSouscripteur(
    ctx: ContexteAppelant,
    souscripteurId: string,
  ): boolean {
    return ctx.societeId === souscripteurId;
  }

  /** Chargement brut (pour l'évaluation) — scoping org uniquement. */
  private async chargerQuestionnaireBrut(organisationId: string, id: string) {
    const q = await this.prisma.questionnaireMedical.findFirst({
      where: {
        id,
        deletedAt: null,
        souscripteur: { organisationId },
      },
      include: {
        souscripteur: { select: { id: true, nom: true, type: true } },
      },
    });
    if (!q) {
      throw new NotFoundException('Questionnaire médical introuvable.');
    }
    return q;
  }

  /**
   * Chargement avec contrôle d'accès : médecin souscripteur OU le souscripteur
   * concerné. Toute autre personne (dont ASSUREUR_MEDECIN_CONSEIL) → 403.
   */
  private async chargerQuestionnaire(ctx: ContexteAppelant, id: string) {
    const q = await this.chargerQuestionnaireBrut(ctx.organisationId, id);

    const estMedecin = ctx.roleChain.includes(ROLE_MEDECIN_SOUSCRIPTEUR);
    const estSouscripteur = this.estLeSouscripteur(ctx, q.souscripteurId);
    if (!estMedecin && !estSouscripteur) {
      throw new ForbiddenException(
        "Accès au questionnaire médical réservé à ASSUREUR_MEDECIN_SOUSCRIPTEUR et au souscripteur concerné. ASSUREUR_MEDECIN_CONSEIL n'y a aucun accès.",
      );
    }
    // La décision n'est visible du souscripteur qu'une fois RENDUE (garantie par
    // la contrainte CHECK : decision non-null ⟺ date_decision non-null).
    return q;
  }

  /** Écriture d'audit — toujours via `log_audit()` (v9 §1.6). */
  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
    tableCible: string,
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
