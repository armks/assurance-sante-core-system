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
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AjouterConsultationDto,
  ClotureDto,
  ClotureForceeDto,
  OuvrirDossierDto,
} from './dto/care-episode.dto';
import {
  ContexteAppelant,
  EvaluationOuverture,
  ROLE_CLOTURE_FORCEE,
  ROLE_MEDECIN_TRAITANT,
  ROLES_GESTION_DOSSIER,
} from './care-episode.types';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * CareEpisodeService — Dossier de Soins et Numéro de Traitement (v1 §15).
 *
 * `ouvrirDossier` implémente le MoteurOuvertureDossier (v1 §15.4) : il évalue
 * quatre conditions (carte valide, adhérent éligible, aucun dossier déjà ouvert,
 * hors délai de carence) et, en cas de refus, retourne la LISTE PRÉCISE des
 * blocages — jamais un message générique.
 *
 * `ajouterConsultation` : le médecin doit être un CENTRE_MEDICAL_MEDECIN du même
 * établissement que le dossier (v10 §1) — vérifié ici, par le trigger Postgres
 * `verifier_medecin_traitant()` et par la policy RLS (défense en profondeur).
 */
@Injectable()
export class CareEpisodeService {
  private readonly logger = new Logger(CareEpisodeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  // --- Ouverture -------------------------------------------------

  /**
   * Ouvre un dossier de soins. **Appel interne uniquement** — il n'existe plus de
   * route publique : la seule voie d'ouverture est
   * `PreauthorizationService.validerCodeConsultation` (v8 §2, checklist v19).
   * `options.codeConsultationId` lie le code et le marque UTILISE_ETABLISSEMENT
   * dans la même transaction.
   */
  async ouvrirDossier(
    user: AuthenticatedUser,
    dto: OuvrirDossierDto,
    options: { codeConsultationId?: string } = {},
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

    if (!dto.adherentId && !dto.beneficiaireId) {
      throw new BadRequestException(
        'adherentId ou beneficiaireId est requis (le patient du dossier).',
      );
    }
    if (dto.adherentId && dto.beneficiaireId) {
      throw new BadRequestException(
        'Renseignez soit adherentId, soit beneficiaireId — pas les deux.',
      );
    }

    const etablissement = await this.prisma.etablissementSante.findFirst({
      where: {
        id: dto.etablissementId,
        organisationId: ctx.organisationId,
        deletedAt: null,
      },
    });
    const police = await this.prisma.police.findFirst({
      where: {
        id: dto.policeId,
        organisationId: ctx.organisationId,
        deletedAt: null,
      },
    });

    const evaluation = await this.evaluerOuverture(dto, etablissement, police);

    if (evaluation.blocages.length > 0) {
      // 409 avec le détail — jamais un message générique (v1 §15.4).
      throw new ConflictException({
        message: "Ouverture du dossier de soins refusée par le moteur d'éligibilité.",
        blocages: evaluation.blocages,
        evaluation: {
          carteValide: evaluation.carteValide,
          adherentEligible: evaluation.adherentEligible,
          aucunDossierOuvert: evaluation.aucunDossierOuvert,
          horsDelaiCarence: evaluation.horsDelaiCarence,
        },
      });
    }

    const planCouvertureId = await this.resoudreGarantieConsultation(
      police!.produitId,
    );

    const id = await this.prisma.$transaction(async (tx) => {
      const dossier = await tx.dossierSoins.create({
        data: {
          organisationId: ctx.organisationId,
          adherentId: dto.adherentId ?? null,
          beneficiaireId: dto.beneficiaireId ?? null,
          etablissementId: dto.etablissementId,
          policeId: dto.policeId,
          planCouvertureId,
          statut: 'OUVERT',
          motifConsultation: dto.motifConsultation,
          diagnosticEntree: dto.diagnosticEntree ?? null,
          codeCim10: dto.codeCim10 ?? null,
          carteValide: true,
          adherentEligible: true,
          aucunDossierOuvert: true,
          horsDelaiCarence: true,
        },
      });
      if (options.codeConsultationId) {
        await tx.codeConsultation.update({
          where: { id: options.codeConsultationId },
          data: {
            statut: 'UTILISE_ETABLISSEMENT',
            dossierSoinsId: dossier.id,
          },
        });
      }
      await this.audit(
        tx,
        ctx.userId,
        'OUVERTURE_DOSSIER_SOINS',
        dossier.id,
        {
          numeroTraitement: dossier.numeroTraitement,
          etablissementId: dto.etablissementId,
          policeId: dto.policeId,
          codeConsultationId: options.codeConsultationId ?? null,
        },
      );
      return dossier.id;
    });

    return this.chargerDossier(ctx.organisationId, id);
  }

  /**
   * Évaluation d'éligibilité (MoteurOuvertureDossier) SANS ouvrir le dossier —
   * réutilisée par la génération d'un code de consultation (v8 §2).
   */
  async evaluerEligibilite(
    organisationId: string,
    params: {
      adherentId?: string;
      beneficiaireId?: string;
      etablissementId: string;
      policeId: string;
    },
  ): Promise<EvaluationOuverture> {
    const etablissement = await this.prisma.etablissementSante.findFirst({
      where: { id: params.etablissementId, organisationId, deletedAt: null },
    });
    const police = await this.prisma.police.findFirst({
      where: { id: params.policeId, organisationId, deletedAt: null },
    });
    return this.evaluerOuverture(params, etablissement, police);
  }

  /** Évaluation pure (MoteurOuvertureDossier) — testable et réutilisable. */
  private async evaluerOuverture(
    dto: {
      adherentId?: string;
      beneficiaireId?: string;
      policeId: string;
    },
    etablissement: { statut: string } | null,
    police: {
      statut: string;
      dateDebut: Date | null;
      dateFin: Date | null;
      produitId: string;
    } | null,
  ): Promise<EvaluationOuverture> {
    const blocages: string[] = [];
    const aujourdHui = new Date();

    // 1. Établissement présent et actif dans le réseau
    if (!etablissement) {
      blocages.push(
        "Établissement inconnu ou hors du réseau de votre organisation.",
      );
    } else if (etablissement.statut !== 'ACTIF') {
      blocages.push(
        `Établissement non actif dans le réseau (statut : ${etablissement.statut}).`,
      );
    }

    // 2. Carte valide = police ACTIVE couvrant la date du jour
    let carteValide = false;
    if (!police) {
      blocages.push('Aucune police correspondante pour votre organisation.');
    } else if (police.statut !== 'ACTIVE') {
      blocages.push(
        `Carte non valide : la police n'est pas active (statut : ${police.statut}).`,
      );
    } else if (police.dateDebut && aujourdHui < police.dateDebut) {
      blocages.push(
        `Carte non valide : la police ne prend effet que le ${police.dateDebut.toISOString().slice(0, 10)}.`,
      );
    } else if (police.dateFin && aujourdHui > police.dateFin) {
      blocages.push(
        `Carte non valide : la police a expiré le ${police.dateFin.toISOString().slice(0, 10)}.`,
      );
    } else {
      carteValide = true;
    }

    // 3. Aucun dossier déjà OUVERT pour ce patient
    const patientWhere = dto.adherentId
      ? { adherentId: dto.adherentId }
      : { beneficiaireId: dto.beneficiaireId };
    const dossierOuvert = await this.prisma.dossierSoins.findFirst({
      where: { ...patientWhere, statut: 'OUVERT', deletedAt: null },
    });
    const aucunDossierOuvert = !dossierOuvert;
    if (dossierOuvert) {
      blocages.push(
        `Un dossier de soins est déjà ouvert pour ce patient (${dossierOuvert.numeroTraitement}). Il doit être clôturé avant d'en ouvrir un nouveau.`,
      );
    }

    // 4. Hors délai de carence (si la garantie CONSULTATION en définit un)
    let horsDelaiCarence = true;
    if (police && police.statut === 'ACTIVE' && police.dateDebut) {
      const garantie = await this.prisma.garantie.findFirst({
        where: {
          produitId: police.produitId,
          categorieActe: 'CONSULTATION',
          deletedAt: null,
        },
      });
      if (garantie?.delaiCarenceJours && garantie.delaiCarenceJours > 0) {
        const finCarence = new Date(police.dateDebut);
        finCarence.setDate(finCarence.getDate() + garantie.delaiCarenceJours);
        if (aujourdHui < finCarence) {
          horsDelaiCarence = false;
          blocages.push(
            `Délai de carence non écoulé : les consultations ne sont couvertes qu'à partir du ${finCarence.toISOString().slice(0, 10)}.`,
          );
        }
      }
    }

    // adhérent éligible : la table adherents n'existe pas encore (PROMPT 12) —
    // on considère l'éligibilité acquise dès que la carte est valide.
    const adherentEligible = carteValide;

    return {
      carteValide,
      adherentEligible,
      aucunDossierOuvert,
      horsDelaiCarence,
      blocages,
    };
  }

  // --- Consultations -------------------------------------------

  async ajouterConsultation(
    user: AuthenticatedUser,
    dossierId: string,
    dto: AjouterConsultationDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

    const dossier = await this.chargerDossierBrut(ctx.organisationId, dossierId);
    if (dossier.statut !== 'OUVERT') {
      throw new ConflictException(
        `On ne peut ajouter une consultation qu'à un dossier OUVERT (statut actuel : ${dossier.statut}).`,
      );
    }

    // v10 §1 : le médecin doit être un CENTRE_MEDICAL_MEDECIN du MÊME établissement.
    const medecin = await this.prisma.profil.findFirst({
      where: { id: dto.medecinId, deletedAt: null },
      select: { id: true, role: true, etablissementId: true },
    });
    if (!medecin || medecin.role !== ROLE_MEDECIN_TRAITANT) {
      throw new BadRequestException(
        "Le médecin indiqué n'est pas un compte CENTRE_MEDICAL_MEDECIN.",
      );
    }
    if (medecin.etablissementId !== dossier.etablissementId) {
      throw new ForbiddenException(
        "Le médecin n'appartient pas à l'établissement du dossier de soins.",
      );
    }

    const id = await this.prisma.$transaction(async (tx) => {
      const consultation = await tx.consultationDossier.create({
        data: {
          dossierSoinsId: dossierId,
          medecinId: dto.medecinId,
          motif: dto.motif,
          observations: dto.observations ?? null,
          diagnostic: dto.diagnostic ?? null,
          codeCim10: dto.codeCim10 ?? null,
          statut: 'EN_COURS',
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'AJOUT_CONSULTATION_DOSSIER',
        dossierId,
        {
          consultationId: consultation.id,
          numeroConsultation: consultation.numeroConsultation,
          medecinId: dto.medecinId,
        },
        'consultations_dossier',
      );
      return consultation.id;
    });

    return this.prisma.consultationDossier.findUnique({ where: { id } });
  }

  // --- Clôture -----------------------------------------------

  async clotureNormale(
    user: AuthenticatedUser,
    dossierId: string,
    dto: ClotureDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const dossier = await this.chargerDossierBrut(ctx.organisationId, dossierId);
    if (!['OUVERT', 'SUSPENDU'].includes(dossier.statut)) {
      throw new ConflictException(
        `Ce dossier ne peut pas être clôturé (statut actuel : ${dossier.statut}).`,
      );
    }
    return this.appliquerCloture(
      ctx,
      dossierId,
      'CLOTURE',
      'NORMALE',
      dto.motif,
    );
  }

  async clotureForcee(
    user: AuthenticatedUser,
    dossierId: string,
    dto: ClotureForceeDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    // GARDE : la clôture forcée est réservée à ASSUREUR_EXPLOITATION.
    if (!ctx.roleChain.includes(ROLE_CLOTURE_FORCEE)) {
      throw new ForbiddenException(
        'La clôture forcée d\'un dossier de soins est réservée à ASSUREUR_EXPLOITATION.',
      );
    }
    const dossier = await this.chargerDossierBrut(ctx.organisationId, dossierId);
    if (['CLOTURE', 'FORCE_CLOS'].includes(dossier.statut)) {
      throw new ConflictException(
        `Ce dossier est déjà clôturé (statut : ${dossier.statut}).`,
      );
    }
    return this.appliquerCloture(
      ctx,
      dossierId,
      'FORCE_CLOS',
      'FORCEE',
      dto.motif,
    );
  }

  private async appliquerCloture(
    ctx: ContexteAppelant,
    dossierId: string,
    statut: string,
    clotureType: string,
    motif?: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.dossierSoins.update({
        where: { id: dossierId },
        data: {
          statut,
          dateCloture: new Date(),
          cloturePar: ctx.userId,
          clotureMotif: motif ?? null,
          clotureType,
        },
      });
      // les consultations encore EN_COURS sont marquées TERMINEE
      await tx.consultationDossier.updateMany({
        where: { dossierSoinsId: dossierId, statut: 'EN_COURS', deletedAt: null },
        data: { statut: 'TERMINEE' },
      });
      await this.audit(
        tx,
        ctx.userId,
        clotureType === 'FORCEE'
          ? 'CLOTURE_FORCEE_DOSSIER_SOINS'
          : 'CLOTURE_DOSSIER_SOINS',
        dossierId,
        { motif: motif ?? null },
      );
    });
    return this.chargerDossier(ctx.organisationId, dossierId);
  }

  // --- Lecture --------------------------------------------

  async listerDossiers(
    user: AuthenticatedUser,
    filtres: { statut?: string; etablissementId?: string },
  ) {
    const ctx = await this.contexteAppelant(user);
    return this.prisma.dossierSoins.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(filtres.statut ? { statut: filtres.statut } : {}),
        ...(filtres.etablissementId
          ? { etablissementId: filtres.etablissementId }
          : {}),
      },
      orderBy: { dateOuverture: 'desc' },
    });
  }

  async obtenirDossier(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    return this.chargerDossier(ctx.organisationId, id);
  }

  // --- Helpers -----------------------------------------

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
      (ROLES_GESTION_DOSSIER as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        "Rôle insuffisant pour gérer les dossiers de soins (accueil / médecin / administratif du centre, ou exploitation / informatique de l'assureur).",
      );
    }
  }

  private async resoudreGarantieConsultation(
    produitId: string,
  ): Promise<string | null> {
    const garantie = await this.prisma.garantie.findFirst({
      where: { produitId, categorieActe: 'CONSULTATION', deletedAt: null },
      select: { id: true },
    });
    return garantie?.id ?? null;
  }

  private async chargerDossierBrut(organisationId: string, id: string) {
    const dossier = await this.prisma.dossierSoins.findFirst({
      where: { id, organisationId, deletedAt: null },
    });
    if (!dossier) {
      throw new NotFoundException('Dossier de soins introuvable.');
    }
    return dossier;
  }

  private async chargerDossier(organisationId: string, id: string) {
    const dossier = await this.prisma.dossierSoins.findFirst({
      where: { id, organisationId, deletedAt: null },
      include: {
        consultations: {
          where: { deletedAt: null },
          orderBy: { dateConsultation: 'asc' },
        },
      },
    });
    if (!dossier) {
      throw new NotFoundException('Dossier de soins introuvable.');
    }
    return dossier;
  }

  /** Écriture d'audit — toujours via `log_audit()` (v9 §1.6). */
  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
    tableCible = 'dossiers_soins',
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
