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
import { SoumettreReclamationDto } from './dto/claims.dto';
import {
  CATEGORIE_VERS_TYPE,
  ContexteAppelant,
  ROLES_GESTION_CLAIMS,
} from './claims.types';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * ClaimsService — réception des réclamations (v1 §16, PROMPT 24, partie 1 / 2).
 *
 * `soumettre` :
 *   1. construit la réclamation à partir de l'acte de dossier (une seule
 *      réclamation vivante par acte — index unique `reclamations_acte_dossier_unique`) ;
 *   2. la VERROUILLE : `SOUMISE → EN_ADJUDICATION` via un compare-and-swap atomique
 *      (`updateMany where statut = 'SOUMISE'`). Toute seconde soumission — séquentielle
 *      OU concurrente — échoue proprement (409) : soit la réclamation est déjà
 *      EN_ADJUDICATION ou au-delà, soit le CAS concurrent a renvoyé 0 ligne.
 *
 * L'appel au microservice Java d'adjudication viendra au prompt suivant — ici on
 * s'arrête au verrouillage.
 */
@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  async soumettre(user: AuthenticatedUser, dto: SoumettreReclamationDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

    const acte = await this.prisma.acteDossier.findFirst({
      where: { id: dto.acteDossierId, deletedAt: null },
    });
    if (!acte) {
      throw new NotFoundException('Acte de dossier introuvable.');
    }

    const dossier = await this.prisma.dossierSoins.findFirst({
      where: { id: acte.dossierSoinsId, deletedAt: null },
    });
    if (!dossier || dossier.organisationId !== ctx.organisationId) {
      // 404 plutôt que 403 : ne pas révéler un dossier d'une autre organisation
      throw new NotFoundException('Dossier de soins introuvable.');
    }

    const garantieId = dossier.planCouvertureId ?? dto.garantieId ?? null;
    if (!garantieId) {
      throw new BadRequestException(
        "Le dossier n'a pas de plan de couverture : précisez `garantieId`.",
      );
    }

    const montant =
      dto.montant ??
      (acte.montantPrescrit
        ? new Decimal(acte.montantPrescrit.toString())
            .mul(acte.quantite ?? 1)
            .toNumber()
        : 0);

    const typeReclamation =
      dto.typeReclamation ??
      CATEGORIE_VERS_TYPE[acte.categorieActe?.toUpperCase() ?? ''] ??
      'AUTRE';

    // 1. s'assurer qu'une réclamation existe (au statut SOUMISE)
    let reclamation = await this.prisma.reclamation.findFirst({
      where: { acteDossierId: acte.id, deletedAt: null },
    });

    if (!reclamation) {
      try {
        reclamation = await this.prisma.$transaction(async (tx) => {
          const r = await tx.reclamation.create({
            data: {
              organisationId: ctx.organisationId,
              dossierSoinsId: dossier.id,
              acteDossierId: acte.id,
              adherentId: dossier.adherentId,
              beneficiaireId: dossier.beneficiaireId,
              policeId: dossier.policeId,
              garantieId,
              montant: new Decimal(montant).toFixed(2),
              typeReclamation,
              statut: 'SOUMISE',
            },
          });
          await this.audit(tx, ctx.userId, 'CREATION_RECLAMATION', r.id, {
            acteDossierId: acte.id,
            montant: new Decimal(montant).toFixed(2),
            type: typeReclamation,
          });
          return r;
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          // création concurrente : l'autre requête a gagné, on récupère sa ligne
          reclamation = await this.prisma.reclamation.findFirst({
            where: { acteDossierId: acte.id, deletedAt: null },
          });
        } else {
          throw e;
        }
      }
    }

    if (!reclamation) {
      throw new ConflictException(
        'Impossible de récupérer la réclamation après une soumission concurrente.',
      );
    }

    // idempotence : refuse si déjà EN_ADJUDICATION ou au-delà
    if (reclamation.statut !== 'SOUMISE') {
      throw new ConflictException(
        `Réclamation déjà « ${reclamation.statut} » — soumission ignorée (idempotence).`,
      );
    }

    // 2. compare-and-swap atomique : SOUMISE → EN_ADJUDICATION
    const { count } = await this.prisma.reclamation.updateMany({
      where: { id: reclamation.id, statut: 'SOUMISE', deletedAt: null },
      data: { statut: 'EN_ADJUDICATION' },
    });
    if (count === 0) {
      throw new ConflictException(
        'Réclamation déjà verrouillée par une soumission concurrente.',
      );
    }

    await this.audit(
      this.prisma,
      ctx.userId,
      'SOUMISSION_RECLAMATION',
      reclamation.id,
      { de: 'SOUMISE', vers: 'EN_ADJUDICATION' },
    );

    return this.chargerReclamation(ctx, reclamation.id);
  }

  async listerReclamations(
    user: AuthenticatedUser,
    filtres: { statut?: string } = {},
  ) {
    const ctx = await this.contexteAppelant(user);
    return this.prisma.reclamation.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(filtres.statut ? { statut: filtres.statut } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { remboursement: true },
    });
  }

  async obtenirReclamation(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    return this.chargerReclamation(ctx, id);
  }

  // --- Autorisation / helpers -------------------------------------

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
      roleChain: permissions?.roleChain ?? [],
    };
  }

  private assertGestion(ctx: ContexteAppelant): void {
    const autorise = ctx.roleChain.some((code) =>
      (ROLES_GESTION_CLAIMS as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        'Rôle insuffisant : la soumission des réclamations est réservée aux rôles ASSUREUR habilités (direction, exploitation, informatique).',
      );
    }
  }

  private async chargerReclamation(ctx: ContexteAppelant, id: string) {
    const reclamation = await this.prisma.reclamation.findFirst({
      where: { id, organisationId: ctx.organisationId, deletedAt: null },
      include: { remboursement: true },
    });
    if (!reclamation) {
      throw new NotFoundException('Réclamation introuvable.');
    }
    return reclamation;
  }

  /** Écriture d'audit — toujours via `log_audit()` (v9 §1.6). */
  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
    tableCible = 'reclamations',
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
