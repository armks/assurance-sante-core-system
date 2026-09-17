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
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CareEpisodeService } from '../care-episode/care-episode.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { AjouterActeDto, ValiderPreautorisationDto } from './dto/acte.dto';
import {
  GenererFactureSelectionDto,
  ValiderCodeFacturationDto,
} from './dto/facture.dto';
import {
  CreerOrdonnanceDto,
  DispensationDto,
  ValiderCodeOrdonnanceDto,
} from './dto/ordonnance.dto';
import {
  GenererCodeConsultationDto,
  ValiderCodeConsultationDto,
} from './dto/preauthorization.dto';
import {
  ALPHABET_CODE,
  ContexteAppelant,
  LONGUEUR_CODE,
  ROLES_ADHERENT,
  ROLES_AJOUT_ACTE,
  ROLES_CENTRE_MEDICAL,
  ROLES_GENERATION_FACTURE,
  ROLES_PHARMACIE,
  ROLE_CONFIRMATION_PAIEMENT,
  ROLE_MEDECIN_TRAITANT,
  ROLE_VALIDATION_PREAUTORISATION,
  STATUTS_PREAUTORISATION_NON_FACTURABLES,
  TAUX_COUVERTURE_DEFAUT,
  TYPE_VISITE_PREAUTORISATION_OBLIGATOIRE,
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

    /**
     * Fuite inter-établissement corrigée (reproduction du test du PROMPT 18,
     * audit demandé après le fix care-episode) : le contrôle ci-dessus ne
     * vérifie que la cohérence `dto.etablissementId` / `code.etablissementId`
     * — jamais que l'APPELANT appartient lui-même à cet établissement. Un
     * compte CENTRE_MEDICAL_* de N'IMPORTE QUEL établissement du réseau
     * pouvait valider (et donc ouvrir, à son nom) un code émis pour un AUTRE
     * établissement, simplement en indiquant le bon `etablissementId` dans le
     * corps de la requête (reproduit en HTTP réel : 201, dossier ouvert).
     * ASSUREUR_EXPLOITATION/INFORMATIQUE restent non scopés (organisation
     * entière), même pattern que `assertEtablissementDossier` (care-episode)
     * et `genererFacture`/`ajouterActe`/`obtenirFacture` (ce même fichier).
     */
    const estCentreMedical = ctx.roleChain.some((r) =>
      (ROLES_CENTRE_MEDICAL as readonly string[]).includes(r),
    );
    if (estCentreMedical && ctx.etablissementId !== code.etablissementId) {
      throw new ForbiddenException(
        "Vous n'appartenez pas à l'établissement pour lequel ce code a été émis.",
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

  // =====================================================================
  // Code Référence d'Ordonnance (v8 §3)
  // =====================================================================

  /**
   * Crée une ordonnance ET son code de retrait dans la même transaction.
   * Appelé par le médecin (ou le personnel administratif du centre). Le code
   * n'est JAMAIS renvoyé ici — il part vers l'adhérent (APP/SMS), qui le
   * récupère via `GET /preauthorization/codes-ordonnance`.
   */
  async creerOrdonnance(user: AuthenticatedUser, dto: CreerOrdonnanceDto) {
    const ctx = await this.contexteAppelant(user);

    const consultation = await this.prisma.consultationDossier.findFirst({
      where: { id: dto.consultationId, deletedAt: null },
      include: { dossier: true },
    });
    if (
      !consultation ||
      consultation.dossier.organisationId !== ctx.organisationId
    ) {
      throw new NotFoundException('Consultation introuvable.');
    }
    if (consultation.statut === 'ANNULEE') {
      throw new ConflictException(
        'On ne peut pas prescrire sur une consultation annulée.',
      );
    }

    // Le médecin de l'ordonnance DOIT être celui de la consultation (v10 §1).
    if (consultation.medecinId !== dto.medecinId) {
      throw new BadRequestException(
        "Le médecin de l'ordonnance doit être celui de la consultation.",
      );
    }

    // Qui prescrit ? le médecin lui-même, ou le personnel administratif du
    // même établissement.
    const estLeMedecin =
      ctx.roleChain.includes(ROLE_MEDECIN_TRAITANT) &&
      ctx.userId === dto.medecinId;
    const estAdminDuCentre =
      ['CENTRE_MEDICAL_ADMINISTRATIF', 'CENTRE_MEDICAL_ACCUEIL'].some((r) =>
        ctx.roleChain.includes(r),
      ) && ctx.etablissementId === consultation.dossier.etablissementId;
    if (!estLeMedecin && !estAdminDuCentre) {
      throw new ForbiddenException(
        "Seul le médecin de la consultation (ou l'administratif de son établissement) peut établir l'ordonnance.",
      );
    }

    const dossier = consultation.dossier;
    if (!dossier.adherentId && !dossier.beneficiaireId) {
      throw new BadRequestException(
        "Le dossier de soins n'identifie aucun patient.",
      );
    }

    const code = await this.genererCodeOrdonnanceUnique();

    const resultat = await this.prisma.$transaction(async (tx) => {
      const ordonnance = await tx.ordonnance.create({
        data: {
          organisationId: ctx.organisationId,
          dossierSoinsId: dossier.id,
          consultationId: consultation.id,
          medecinId: dto.medecinId,
          statut: 'ACTIVE',
        },
      });
      // Lignes normalisées (révision majeure, verrou par ligne plutôt que par
      // ordonnance entière — module pharmacy/) : plus de jsonb.
      await tx.ligneOrdonnance.createMany({
        data: dto.lignes.map((l) => ({
          ordonnanceId: ordonnance.id,
          denominationMedicament: l.medicament,
          dosage: l.dosage ?? null,
          posologie: l.posologie,
          duree: l.duree ?? null,
          quantitePrescrite: l.quantite ?? 1,
        })),
      });
      const ligneCode = await tx.codeOrdonnance.create({
        data: {
          organisationId: ctx.organisationId,
          ordonnanceId: ordonnance.id,
          adherentId: dossier.adherentId,
          beneficiaireId: dossier.beneficiaireId,
          code,
          statut: 'EMIS',
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'GENERATION_CODE_ORDONNANCE',
        ligneCode.id,
        { ordonnanceId: ordonnance.id, lignes: dto.lignes.length },
        'codes_ordonnance',
      );
      return { ordonnance, ligneCode };
    });

    // Réponse au MÉDECIN — sans le code (il ne doit jamais le voir).
    return {
      ordonnanceId: resultat.ordonnance.id,
      statut: resultat.ordonnance.statut,
      dateValidite: resultat.ordonnance.dateValidite,
      nombreLignes: dto.lignes.length,
      message:
        "Ordonnance établie. Le code de retrait a été transmis à l'adhérent (APP/SMS).",
    };
  }

  /** Codes d'ordonnance de l'adhérent connecté — AVEC la valeur du code (les siens). */
  async listerMesCodesOrdonnance(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.adherentId) {
      return [];
    }
    const codes = await this.prisma.codeOrdonnance.findMany({
      where: { adherentId: ctx.adherentId },
      orderBy: { dateEmission: 'desc' },
      take: 50,
    });
    return codes.map((c) => ({
      id: c.id,
      ordonnanceId: c.ordonnanceId,
      code: c.code,
      statut: c.statut,
      dateEmission: c.dateEmission,
      dateExpiration: c.dateExpiration,
    }));
  }

  /**
   * Codes d'ordonnance déjà pris en charge par LA PHARMACIE de l'appelant
   * (audit dashboard pharmacie) — scope strict sur `ctx.pharmacieId`, jamais
   * un paramètre client (aucun endpoint équivalent n'existait avant ce
   * prompt). Sert la vue d'ensemble (en attente de dispensation / déjà
   * dispensées) des 3 sous-rôles PHARMACIE_*.
   */
  async listerCodesOrdonnancePharmacie(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    const estPharmacie = ctx.roleChain.some((r) =>
      (ROLES_PHARMACIE as readonly string[]).includes(r),
    );
    if (!estPharmacie || !ctx.pharmacieId) {
      throw new ForbiddenException(
        "Réservé au personnel d'une pharmacie du réseau.",
      );
    }
    const codes = await this.prisma.codeOrdonnance.findMany({
      where: { pharmacieUtilisatriceId: ctx.pharmacieId },
      orderBy: { dateEmission: 'desc' },
      take: 100,
      include: {
        ordonnance: {
          select: {
            id: true,
            statut: true,
            dossier: { select: { numeroTraitement: true } },
            lignesOrdonnance: true,
          },
        },
      },
    });
    return codes.map((c) => ({
      id: c.id,
      code: c.code,
      statut: c.statut,
      dateEmission: c.dateEmission,
      dateExpiration: c.dateExpiration,
      ordonnance: c.ordonnance
        ? {
            id: c.ordonnance.id,
            statut: c.ordonnance.statut,
            numeroTraitement: c.ordonnance.dossier.numeroTraitement,
            // Lignes normalisées (révision majeure, module pharmacy/) : plus de jsonb.
            lignes: c.ordonnance.lignesOrdonnance.map((l) => ({
              medicament: l.denominationMedicament,
              dosage: l.dosage,
              posologie: l.posologie,
              duree: l.duree,
              quantite: l.quantitePrescrite,
              statut: l.statut,
            })),
          }
        : null,
    }));
  }

  /**
   * Saisie du code côté PHARMACIE. Si valide, RÉVÈLE le contenu complet de
   * l'ordonnance (c'est le seul moment où la pharmacie y a accès) et marque le
   * code PRESENTE_PHARMACIE. Une pharmacie ne peut pas relire un code déjà
   * pris en charge par une autre pharmacie, ni un code entièrement dispensé.
   */
  async validerCodeOrdonnance(
    user: AuthenticatedUser,
    dto: ValiderCodeOrdonnanceDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx, dto.pharmacieId);

    const code = await this.prisma.codeOrdonnance.findUnique({
      where: { code: dto.code.toUpperCase() },
    });
    if (!code || code.organisationId !== ctx.organisationId) {
      throw new NotFoundException("Code d'ordonnance invalide.");
    }

    if (code.statut === 'UTILISE_COMPLET') {
      throw new ConflictException(
        'Cette ordonnance a déjà été entièrement dispensée.',
      );
    }
    if (code.statut === 'ANNULE') {
      throw new GoneException("Ce code d'ordonnance a été annulé.");
    }
    if (code.statut === 'EXPIRE' || code.dateExpiration.getTime() < Date.now()) {
      if (code.statut !== 'EXPIRE') {
        await this.prisma.codeOrdonnance.update({
          where: { id: code.id },
          data: { statut: 'EXPIRE' },
        });
      }
      throw new GoneException(
        "Ce code d'ordonnance a expiré (validité 7 jours).",
      );
    }
    // Déjà pris en charge par une AUTRE pharmacie → refus.
    if (
      code.pharmacieUtilisatriceId &&
      code.pharmacieUtilisatriceId !== dto.pharmacieId
    ) {
      throw new ForbiddenException(
        'Cette ordonnance est déjà prise en charge par une autre pharmacie.',
      );
    }

    const ordonnance = code.ordonnanceId
      ? await this.prisma.ordonnance.findUnique({
          where: { id: code.ordonnanceId },
          include: {
            medecin: { select: { id: true, role: true } },
            dossier: { select: { numeroTraitement: true } },
            lignesOrdonnance: true,
          },
        })
      : null;
    if (!ordonnance || ordonnance.deletedAt) {
      throw new NotFoundException('Ordonnance introuvable.');
    }
    if (['EXPIREE', 'ANNULEE'].includes(ordonnance.statut)) {
      throw new GoneException(
        `Ordonnance ${ordonnance.statut.toLowerCase()} — dispensation impossible.`,
      );
    }

    if (code.statut === 'EMIS') {
      await this.prisma.$transaction(async (tx) => {
        await tx.codeOrdonnance.update({
          where: { id: code.id },
          data: {
            statut: 'PRESENTE_PHARMACIE',
            pharmacieUtilisatriceId: dto.pharmacieId,
          },
        });
        await this.audit(
          tx,
          ctx.userId,
          'VALIDATION_CODE_ORDONNANCE',
          code.id,
          { ordonnanceId: ordonnance.id, pharmacieId: dto.pharmacieId },
          'codes_ordonnance',
        );
      });
    }

    // RÉVÉLATION du contenu — uniquement ici, uniquement à cette pharmacie.
    return {
      code: {
        id: code.id,
        statut: code.statut === 'EMIS' ? 'PRESENTE_PHARMACIE' : code.statut,
      },
      ordonnance: {
        id: ordonnance.id,
        statut: ordonnance.statut,
        datePrescription: ordonnance.datePrescription,
        dateValidite: ordonnance.dateValidite,
        medecinId: ordonnance.medecinId,
        numeroTraitement: ordonnance.dossier.numeroTraitement,
        // Lignes normalisées (révision majeure, module pharmacy/) : plus de jsonb.
        lignes: ordonnance.lignesOrdonnance.map((l) => ({
          medicament: l.denominationMedicament,
          dosage: l.dosage,
          posologie: l.posologie,
          duree: l.duree,
          quantite: l.quantitePrescrite,
          statut: l.statut,
        })),
      },
    };
  }

  /**
   * Dispensation partielle ou complète, après coup. Réservée à la pharmacie qui
   * a validé le code.
   */
  async marquerDispensation(
    user: AuthenticatedUser,
    codeId: string,
    dto: DispensationDto,
  ) {
    const ctx = await this.contexteAppelant(user);

    const code = await this.prisma.codeOrdonnance.findFirst({
      where: { id: codeId, organisationId: ctx.organisationId },
    });
    if (!code) {
      throw new NotFoundException("Code d'ordonnance introuvable.");
    }
    this.assertPharmacie(ctx, code.pharmacieUtilisatriceId ?? '');
    if (
      !code.pharmacieUtilisatriceId ||
      code.pharmacieUtilisatriceId !== ctx.pharmacieId
    ) {
      throw new ForbiddenException(
        "Seule la pharmacie qui a validé le code peut enregistrer la dispensation.",
      );
    }
    if (!['PRESENTE_PHARMACIE', 'UTILISE_PARTIEL'].includes(code.statut)) {
      throw new ConflictException(
        `Dispensation impossible depuis le statut ${code.statut}.`,
      );
    }

    const complet = dto.type === 'COMPLETE';
    const statutCode = complet ? 'UTILISE_COMPLET' : 'UTILISE_PARTIEL';
    const statutOrdonnance = complet
      ? 'COMPLETEMENT_DELIVREE'
      : 'PARTIELLEMENT_DELIVREE';

    await this.prisma.$transaction(async (tx) => {
      await tx.codeOrdonnance.update({
        where: { id: codeId },
        data: { statut: statutCode },
      });
      if (code.ordonnanceId) {
        await tx.ordonnance.update({
          where: { id: code.ordonnanceId },
          data: { statut: statutOrdonnance },
        });
      }
      await this.audit(
        tx,
        ctx.userId,
        'DISPENSATION_ORDONNANCE',
        codeId,
        {
          type: dto.type,
          lignesDelivrees: dto.lignesDelivrees ?? null,
          commentaire: dto.commentaire ?? null,
        },
        'codes_ordonnance',
      );
    });

    return {
      code: { id: codeId, statut: statutCode },
      ordonnance: { id: code.ordonnanceId, statut: statutOrdonnance },
    };
  }

  private assertPharmacie(ctx: ContexteAppelant, pharmacieId: string): void {
    const estPharmacie = ctx.roleChain.some((r) =>
      (ROLES_PHARMACIE as readonly string[]).includes(r),
    );
    if (!estPharmacie) {
      throw new ForbiddenException(
        "Réservé au personnel d'une pharmacie du réseau.",
      );
    }
    if (!ctx.pharmacieId || ctx.pharmacieId !== pharmacieId) {
      throw new ForbiddenException(
        "Vous ne pouvez agir que pour votre propre pharmacie.",
      );
    }
  }

  // =====================================================================
  // Ticket de Soins (v8 §4) — le ticket lui-même est créé / clôturé
  // automatiquement par CareEpisodeService (ouverture / clôture du dossier).
  // Ici : l'ajout d'actes, refusé si le ticket n'est plus OUVERT.
  // =====================================================================

  async obtenirTicket(user: AuthenticatedUser, ticketSoinsId: string) {
    const ctx = await this.contexteAppelant(user);
    const ticket = await this.chargerTicket(ctx.organisationId, ticketSoinsId);
    const actes = await this.prisma.acteDossier.findMany({
      where: { ticketSoinsId, deletedAt: null },
      orderBy: { datePrescription: 'asc' },
    });
    return { ...ticket, actes };
  }

  async ajouterActe(
    user: AuthenticatedUser,
    ticketSoinsId: string,
    dto: AjouterActeDto,
  ) {
    const ctx = await this.contexteAppelant(user);

    const ticket = await this.prisma.ticketSoins.findFirst({
      where: { id: ticketSoinsId },
      include: { dossier: { include: { police: true } } },
    });
    if (!ticket || ticket.dossier.organisationId !== ctx.organisationId) {
      throw new NotFoundException('Ticket de soins introuvable.');
    }

    // Autorisation : personnel du centre (même établissement) ou assureur.
    const autorise = ctx.roleChain.some((r) =>
      (ROLES_AJOUT_ACTE as readonly string[]).includes(r),
    );
    if (!autorise) {
      throw new ForbiddenException(
        "Rôle insuffisant pour ajouter un acte à un ticket de soins.",
      );
    }
    const estCentreMedical = ctx.roleChain.some((r) =>
      (ROLES_CENTRE_MEDICAL as readonly string[]).includes(r),
    );
    if (
      estCentreMedical &&
      ctx.etablissementId !== ticket.dossier.etablissementId
    ) {
      throw new ForbiddenException(
        "Vous n'appartenez pas à l'établissement de ce dossier de soins.",
      );
    }

    // GARDE CENTRALE : le ticket doit être OUVERT (le trigger Postgres double
    // ce contrôle même pour un INSERT SQL direct).
    if (ticket.statut !== 'OUVERT') {
      throw new ConflictException(
        `Le ticket de soins est ${ticket.statut} — impossible d'y ajouter un acte (ticket verrouillé).`,
      );
    }

    if (dto.consultationId) {
      const consultation = await this.prisma.consultationDossier.findFirst({
        where: {
          id: dto.consultationId,
          dossierSoinsId: ticket.dossierSoinsId,
          deletedAt: null,
        },
      });
      if (!consultation) {
        throw new BadRequestException(
          "La consultation indiquée n'appartient pas à ce dossier de soins.",
        );
      }
    }

    // Simulation INDICATIVE (v3 §5 étendu) — lecture seule, avant la
    // transaction d'écriture. Ne bloque jamais l'ajout de l'acte : une
    // absence de tarif/garantie renvoie simplement `null` (rien à simuler).
    const simulation = await this.simulerMontantActe(
      ctx.organisationId,
      ticket.dossier.etablissementId,
      ticket.dossier.police.produitId,
      dto,
    );

    // Pré-autorisation obligatoire (analyses/examens médicaux) : décidée
    // EXCLUSIVEMENT depuis le type de visite RÉEL du dossier (jamais une
    // valeur envoyée par le client) — v3 §5 étendu.
    const statutPreautorisation =
      ticket.dossier.typeVisite === TYPE_VISITE_PREAUTORISATION_OBLIGATOIRE
        ? 'EN_ATTENTE_VALIDATION'
        : 'NON_REQUISE';

    const id = await this.prisma.$transaction(async (tx) => {
      const acte = await tx.acteDossier.create({
        data: {
          dossierSoinsId: ticket.dossierSoinsId,
          ticketSoinsId: ticket.id,
          consultationId: dto.consultationId ?? null,
          medecinPrescripteurId: dto.medecinPrescripteurId ?? null,
          categorieActe: dto.categorieActe,
          libelle: dto.libelle,
          codeActe: dto.codeActe ?? null,
          quantite: dto.quantite ?? 1,
          montantPrescrit:
            dto.montantPrescrit === undefined
              ? null
              : new Decimal(dto.montantPrescrit).toFixed(2),
          montantSimuleAssurance: simulation?.montantSimuleAssurance ?? null,
          montantSimulePatient: simulation?.montantSimulePatient ?? null,
          ticketModerateurSimule: simulation?.ticketModerateurSimule ?? null,
          statutPreautorisation,
          dateRealisation: dto.dateRealisation
            ? new Date(dto.dateRealisation)
            : null,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'AJOUT_ACTE_DOSSIER',
        acte.id,
        {
          ticketSoinsId: ticket.id,
          dossierSoinsId: ticket.dossierSoinsId,
          categorie: dto.categorieActe,
          simulation: simulation ?? null,
          statutPreautorisation,
        },
        'actes_dossier',
      );
      return acte.id;
    });

    return this.prisma.acteDossier.findUnique({ where: { id } });
  }

  /**
   * Simulation INDICATIVE du remboursement au moment de l'ajout d'un acte —
   * tarif conventionné (s'il existe pour l'établissement/l'acte) plafonnant
   * le montant facturé, puis taux de couverture de la garantie applicable.
   * Reste indicative : le calcul définitif de l'adjudication (microservice
   * Java, `Adjudicateur.calculer`) garde le dernier mot (franchise, plafond
   * ANNUEL restant, verrouillage transactionnel — rien de tout cela n'est
   * répliqué ici). Renvoie `null` si aucun montant facturé n'est fourni, ou
   * si aucune garantie ne correspond à la catégorie d'acte du produit du
   * patient (rien à simuler) — ne bloque jamais l'ajout de l'acte lui-même.
   */
  private async simulerMontantActe(
    organisationId: string,
    etablissementId: string,
    produitId: string,
    dto: Pick<AjouterActeDto, 'categorieActe' | 'codeActe' | 'montantPrescrit' | 'quantite'>,
  ): Promise<{
    montantSimuleAssurance: string;
    montantSimulePatient: string;
    ticketModerateurSimule: string;
  } | null> {
    if (dto.montantPrescrit === undefined) {
      return null;
    }

    const garantie = await this.prisma.garantie.findFirst({
      where: { produitId, categorieActe: dto.categorieActe, deletedAt: null },
    });
    if (!garantie) {
      return null;
    }

    const montantFacture = new Decimal(dto.montantPrescrit).mul(dto.quantite ?? 1);

    // Tarif conventionné établissement × acte, s'il existe (même lien que
    // JdbcAdjudicationRepository.SQL_CONTEXTE : codeActe -> referentiel_actes.code
    // -> tarifs_conventionnes). Plafonne le montant facturé, ne l'augmente jamais.
    let montantBase = montantFacture;
    if (dto.codeActe) {
      const acteReferentiel = await this.prisma.referentielActe.findFirst({
        where: { code: dto.codeActe, organisationId, deletedAt: null },
        select: { id: true },
      });
      if (acteReferentiel) {
        const maintenant = new Date();
        const tarif = await this.prisma.tarifConventionne.findFirst({
          where: {
            referentielActeId: acteReferentiel.id,
            etablissementId,
            deletedAt: null,
            dateDebut: { lte: maintenant },
            OR: [{ dateFin: null }, { dateFin: { gte: maintenant } }],
          },
        });
        if (tarif) {
          montantBase = Decimal.min(
            montantFacture,
            new Decimal(tarif.tarifConvention.toString()),
          );
        }
      }
    }

    const taux = new Decimal(
      garantie.tauxCouverture?.toString() ?? String(TAUX_COUVERTURE_DEFAUT),
    );
    let montantSimuleAssurance = montantBase.mul(taux).div(100).toDecimalPlaces(2);
    if (garantie.plafondParActe) {
      const plafond = new Decimal(garantie.plafondParActe.toString());
      if (montantSimuleAssurance.gt(plafond)) {
        montantSimuleAssurance = plafond;
      }
    }
    const montantSimulePatient = montantBase.sub(montantSimuleAssurance);
    const ticketModPct = new Decimal(garantie.ticketModerateur?.toString() ?? '0');
    const ticketModerateurSimule = montantBase
      .mul(ticketModPct)
      .div(100)
      .toDecimalPlaces(2);

    return {
      montantSimuleAssurance: montantSimuleAssurance.toFixed(2),
      montantSimulePatient: montantSimulePatient.toFixed(2),
      ticketModerateurSimule: ticketModerateurSimule.toFixed(2),
    };
  }

  /**
   * Décision du médecin conseil sur un acte en attente de pré-autorisation
   * (analyses/examens médicaux, v3 §5 étendu). Réservée EXCLUSIVEMENT à
   * ASSUREUR_MEDECIN_CONSEIL — pas ASSUREUR_INFORMATIQUE, pas
   * ASSUREUR_EXPLOITATION (même séparation que l'homologation d'un acte du
   * référentiel, module reference/).
   */
  async validerPreautorisation(
    user: AuthenticatedUser,
    acteId: string,
    dto: ValiderPreautorisationDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_VALIDATION_PREAUTORISATION)) {
      throw new ForbiddenException(
        'La validation d’une pré-autorisation est réservée exclusivement à ASSUREUR_MEDECIN_CONSEIL.',
      );
    }

    const acte = await this.prisma.acteDossier.findFirst({
      where: { id: acteId, deletedAt: null },
      include: { dossier: { select: { organisationId: true } } },
    });
    if (!acte || acte.dossier.organisationId !== ctx.organisationId) {
      throw new NotFoundException('Acte introuvable.');
    }
    if (acte.statutPreautorisation !== 'EN_ATTENTE_VALIDATION') {
      throw new ConflictException(
        `Cet acte n'est pas en attente de pré-autorisation (statut actuel : ${acte.statutPreautorisation}).`,
      );
    }

    const nouveauStatut = dto.decision === 'APPROUVE' ? 'APPROUVEE' : 'REFUSEE';

    await this.prisma.$transaction(async (tx) => {
      await tx.acteDossier.update({
        where: { id: acteId },
        data: { statutPreautorisation: nouveauStatut },
      });
      await this.audit(
        tx,
        ctx.userId,
        'PREAUTORISATION_ANALYSE',
        acteId,
        {
          decision: dto.decision,
          motif: dto.motif,
          statutPrecedent: 'EN_ATTENTE_VALIDATION',
          nouveauStatut,
        },
        'actes_dossier',
      );
    });

    return this.prisma.acteDossier.findUnique({ where: { id: acteId } });
  }

  /**
   * File d'attente du médecin conseil — tous les actes ANALYSES_EXAMENS_MEDICAUX
   * en attente de sa décision, organisation entière (rôle ASSUREUR non scopé à
   * un établissement, même pattern que les autres files ASSUREUR_*).
   */
  async listerActesEnAttentePreautorisation(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_VALIDATION_PREAUTORISATION)) {
      throw new ForbiddenException(
        'Réservé exclusivement à ASSUREUR_MEDECIN_CONSEIL.',
      );
    }

    const actes = await this.prisma.acteDossier.findMany({
      where: {
        statutPreautorisation: 'EN_ATTENTE_VALIDATION',
        deletedAt: null,
        dossier: { organisationId: ctx.organisationId },
      },
      include: {
        dossier: {
          select: {
            numeroTraitement: true,
            etablissement: { select: { nom: true } },
            adherent: { select: { nom: true, prenom: true } },
            beneficiaire: { select: { nom: true, prenom: true } },
          },
        },
      },
      orderBy: { datePrescription: 'asc' },
    });

    return actes.map((a) => ({
      id: a.id,
      libelle: a.libelle,
      categorieActe: a.categorieActe,
      codeActe: a.codeActe,
      quantite: a.quantite,
      montantPrescrit: a.montantPrescrit?.toFixed(2) ?? null,
      montantSimuleAssurance: a.montantSimuleAssurance?.toFixed(2) ?? null,
      montantSimulePatient: a.montantSimulePatient?.toFixed(2) ?? null,
      datePrescription: a.datePrescription,
      numeroTraitement: a.dossier.numeroTraitement,
      etablissement: a.dossier.etablissement.nom,
      patient: a.dossier.adherent
        ? `${a.dossier.adherent.prenom} ${a.dossier.adherent.nom}`
        : a.dossier.beneficiaire
          ? `${a.dossier.beneficiaire.prenom} ${a.dossier.beneficiaire.nom}`
          : '—',
    }));
  }

  private async chargerTicket(organisationId: string, ticketSoinsId: string) {
    const ticket = await this.prisma.ticketSoins.findFirst({
      where: { id: ticketSoinsId, dossier: { organisationId } },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket de soins introuvable.');
    }
    return ticket;
  }

  // =====================================================================
  // Code de Facturation (v8 §5) — 4e et dernier code anti-fraude.
  // =====================================================================

  /**
   * Facturation par SÉLECTION D'ACTES, paiement partiel (v8 §5 étendu) : le
   * comptable de l'établissement coche, parmi tous les actes du dossier, ceux
   * à régler MAINTENANT — plusieurs cycles successifs sont possibles sur le
   * même dossier (remplace l'ancienne facturation unique par ticket). EXCLUT
   * automatiquement, quelle que soit la sélection envoyée par le client :
   * - tout acte `EN_ATTENTE_VALIDATION`/`REFUSEE` en pré-autorisation (garde
   *   posée pour les analyses/examens médicaux) ;
   * - tout acte déjà réglé (`LigneFacturation` à `PAYE`).
   * Un acte déjà réclamé par un cycle abandonné (ligne `A_PAYER` orpheline,
   * jamais validée/réglée) est RÉATTACHÉ au nouveau cycle plutôt que dupliqué
   * (au plus une ligne `A_PAYER` par acte, contrainte posée en base).
   */
  async genererFactureSelection(
    user: AuthenticatedUser,
    dossierSoinsId: string,
    dto: GenererFactureSelectionDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    if (
      !ctx.roleChain.some((r) =>
        (ROLES_GENERATION_FACTURE as readonly string[]).includes(r),
      )
    ) {
      throw new ForbiddenException(
        "Rôle insuffisant pour générer une facture (comptable / administratif du centre, ou exploitation / comptable / informatique de l'assureur).",
      );
    }

    const dossier = await this.prisma.dossierSoins.findFirst({
      where: { id: dossierSoinsId, organisationId: ctx.organisationId, deletedAt: null },
      include: { police: true, ticket: true },
    });
    if (!dossier) {
      throw new NotFoundException('Dossier de soins introuvable.');
    }
    if (!dossier.ticket) {
      throw new NotFoundException('Aucun ticket de soins pour ce dossier.');
    }
    const estCentreMedical = ctx.roleChain.some((r) =>
      (ROLES_CENTRE_MEDICAL as readonly string[]).includes(r),
    );
    if (estCentreMedical && ctx.etablissementId !== dossier.etablissementId) {
      throw new ForbiddenException(
        "Vous n'appartenez pas à l'établissement de ce dossier de soins.",
      );
    }
    if (dossier.ticket.statut === 'ANNULE') {
      throw new ConflictException(
        'Le ticket de soins est ANNULÉ — aucune facturation possible.',
      );
    }

    const acteIdsDemandes = [...new Set(dto.acteIds)];
    const actesDemandes = await this.prisma.acteDossier.findMany({
      where: {
        id: { in: acteIdsDemandes },
        dossierSoinsId,
        deletedAt: null,
        statut: { not: 'ANNULE' },
      },
      include: {
        lignesFacturation: { where: { statut: { in: ['A_PAYER', 'PAYE'] } } },
      },
    });
    if (actesDemandes.length !== acteIdsDemandes.length) {
      throw new BadRequestException(
        "Un ou plusieurs actes sélectionnés n'appartiennent pas à ce dossier (ou sont annulés).",
      );
    }

    const nonFacturables: readonly string[] = STATUTS_PREAUTORISATION_NON_FACTURABLES;
    const actesEligibles = actesDemandes.filter(
      (a) =>
        !nonFacturables.includes(a.statutPreautorisation) &&
        !a.lignesFacturation.some((l) => l.statut === 'PAYE'),
    );
    const acteIdsExclus = acteIdsDemandes.filter(
      (id) => !actesEligibles.some((a) => a.id === id),
    );
    if (actesEligibles.length === 0) {
      throw new ConflictException({
        message:
          "Aucun des actes sélectionnés n'est facturable (en attente ou refusé en pré-autorisation, ou déjà réglé).",
        acteIdsExclus,
      });
    }

    const { montantTotal, montantAssurance, montantPatient } =
      await this.calculerMontantsPourActes(dossier.police.produitId, actesEligibles);

    const code = await this.genererCodeFacturationUnique();

    const facture = await this.prisma.$transaction(async (tx) => {
      const f = await tx.factureDossier.create({
        data: {
          organisationId: ctx.organisationId,
          dossierSoinsId,
          ticketSoinsId: dossier.ticket!.id,
          etablissementId: dossier.etablissementId,
          adherentId: dossier.adherentId,
          beneficiaireId: dossier.beneficiaireId,
          montantTotal,
          montantAssurance,
          montantPatient,
          statut: 'EMISE',
          codeFacturation: code,
        },
      });

      for (const acte of actesEligibles) {
        const ligneAPayer = acte.lignesFacturation.find((l) => l.statut === 'A_PAYER');
        const montantReclame = new Decimal(acte.montantPrescrit?.toString() ?? '0')
          .mul(acte.quantite)
          .toFixed(2);
        if (ligneAPayer) {
          // Cycle abandonné réattaché — jamais de doublon pour le même acte.
          await tx.ligneFacturation.update({
            where: { id: ligneAPayer.id },
            data: { factureDossierId: f.id, montantReclame },
          });
        } else {
          await tx.ligneFacturation.create({
            data: {
              organisationId: ctx.organisationId,
              factureDossierId: f.id,
              acteDossierId: acte.id,
              montantReclame,
              statut: 'A_PAYER',
            },
          });
        }
      }

      await this.audit(
        tx,
        ctx.userId,
        'GENERATION_CODE_FACTURATION',
        f.id,
        {
          dossierSoinsId,
          acteIdsInclus: actesEligibles.map((a) => a.id),
          acteIdsExclus,
          montantTotal,
          montantPatient,
        },
        'factures_dossier',
      );
      return f;
    });

    // Réponse à l'ASSUREUR : montants, PAS le code (transmis à l'adhérent —
    // dashboard dès maintenant, e-mail/SMS à raccorder séparément).
    return {
      factureId: facture.id,
      statut: facture.statut,
      montantTotal: facture.montantTotal.toFixed(2),
      montantAssurance: facture.montantAssurance.toFixed(2),
      montantPatient: facture.montantPatient.toFixed(2),
      acteIdsInclus: actesEligibles.map((a) => a.id),
      acteIdsExclus,
      message:
        acteIdsExclus.length > 0
          ? "Facture générée pour les actes sélectionnés facturables. Le code de facturation a été transmis à l'adhérent pour validation. " +
            `${acteIdsExclus.length} acte(s) sélectionné(s) exclu(s) (en attente/refusé de pré-autorisation, ou déjà réglé).`
          : "Facture générée pour les actes sélectionnés. Le code de facturation a été transmis à l'adhérent pour validation.",
    };
  }

  /** Factures de l'adhérent connecté — AVEC le code + la synthèse chiffrée. */
  async listerMesFactures(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.adherentId) {
      return [];
    }
    const factures = await this.prisma.factureDossier.findMany({
      where: { adherentId: ctx.adherentId, deletedAt: null },
      include: { dossier: { select: { numeroTraitement: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return factures.map((f) => ({
      id: f.id,
      ticketSoinsId: f.ticketSoinsId,
      numeroTraitement: f.dossier.numeroTraitement,
      code: f.codeFacturation,
      statut: f.statut,
      codeValideParPatient: f.codeValideParPatient,
      montantTotal: f.montantTotal.toFixed(2),
      montantAssurance: f.montantAssurance.toFixed(2),
      montantPatient: f.montantPatient.toFixed(2),
    }));
  }

  /**
   * Validation du code par l'ADHÉRENT lui-même (jamais l'établissement).
   * Marque `code_valide_par_patient = true` — condition SINE QUA NON du règlement.
   */
  async validerCodeFacturation(
    user: AuthenticatedUser,
    dto: ValiderCodeFacturationDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    if (
      !ctx.roleChain.some((r) =>
        (ROLES_ADHERENT as readonly string[]).includes(r),
      )
    ) {
      throw new ForbiddenException(
        "Seul l'adhérent concerné peut valider un code de facturation.",
      );
    }

    const facture = await this.prisma.factureDossier.findUnique({
      where: { codeFacturation: dto.code.toUpperCase() },
    });
    if (
      !facture ||
      facture.organisationId !== ctx.organisationId ||
      facture.deletedAt
    ) {
      throw new NotFoundException('Code de facturation invalide.');
    }
    if (!ctx.adherentId || facture.adherentId !== ctx.adherentId) {
      throw new ForbiddenException('Cette facture ne vous concerne pas.');
    }
    if (facture.codeValideParPatient) {
      throw new ConflictException('Ce code a déjà été validé.');
    }
    if (['REGLEE', 'CONTESTEE'].includes(facture.statut)) {
      throw new ConflictException(
        `Facture ${facture.statut.toLowerCase()} — validation impossible.`,
      );
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const f = await tx.factureDossier.update({
        where: { id: facture.id },
        data: {
          codeValideParPatient: true,
          dateValidationPatient: new Date(),
          statut: 'VALIDEE',
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'VALIDATION_CODE_FACTURATION',
        f.id,
        { montantPatient: f.montantPatient.toFixed(2) },
        'factures_dossier',
      );
      return f;
    });

    return {
      factureId: maj.id,
      statut: maj.statut,
      codeValideParPatient: true,
      montantPatient: maj.montantPatient.toFixed(2),
    };
  }

  /**
   * Confirmation du paiement — réservé à ASSUREUR_COMPTABLE.
   *
   * GARDE BLOQUANTE EXPLICITE : refuse absolument si `code_valide_par_patient`
   * est false (v8 §5, checklist v19). Cette garde est dans le service — elle
   * s'applique même si on contourne le contrôleur. Le trigger Postgres
   * `verifier_facture_reglable()` la double au niveau base.
   */
  async confirmerPaiement(user: AuthenticatedUser, factureId: string) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_CONFIRMATION_PAIEMENT)) {
      throw new ForbiddenException(
        'La confirmation de paiement est réservée à ASSUREUR_COMPTABLE.',
      );
    }

    const facture = await this.prisma.factureDossier.findFirst({
      where: {
        id: factureId,
        organisationId: ctx.organisationId,
        deletedAt: null,
      },
    });
    if (!facture) {
      throw new NotFoundException('Facture introuvable.');
    }

    // >>> GARDE ANTI-FRAUDE — NE JAMAIS RETIRER <<<
    if (!facture.codeValideParPatient) {
      throw new ForbiddenException(
        "Règlement impossible : le code de facturation n'a pas été validé par l'adhérent. " +
          "Cette validation par le patient est obligatoire avant tout paiement (anti-fraude, v8 §5).",
      );
    }

    if (facture.statut === 'REGLEE') {
      throw new ConflictException('Cette facture a déjà été réglée.');
    }
    if (facture.statut !== 'VALIDEE') {
      throw new ConflictException(
        `Facture au statut ${facture.statut} — règlement impossible.`,
      );
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const f = await tx.factureDossier.update({
        where: { id: factureId },
        data: {
          statut: 'REGLEE',
          dateReglement: new Date(),
          reglePar: ctx.userId,
        },
      });
      // Marque PAYE uniquement les lignes de CE cycle précis — jamais les
      // autres cycles (facturation par sélection d'actes, paiement partiel).
      const lignes = await tx.ligneFacturation.updateMany({
        where: { factureDossierId: factureId, statut: 'A_PAYER' },
        data: { statut: 'PAYE', datePaiement: new Date() },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CONFIRMATION_PAIEMENT_FACTURE',
        f.id,
        {
          montantAssurance: f.montantAssurance.toFixed(2),
          montantPatient: f.montantPatient.toFixed(2),
          lignesPayees: lignes.count,
        },
        'factures_dossier',
      );
      return f;
    });

    const soldeRestantDu = await this.calculerSoldeRestantDu(maj.dossierSoinsId);

    return {
      factureId: maj.id,
      statut: maj.statut,
      montantAssurance: maj.montantAssurance.toFixed(2),
      montantPatient: maj.montantPatient.toFixed(2),
      dateReglement: maj.dateReglement,
      soldeRestantDu: soldeRestantDu.toFixed(2),
    };
  }

  /**
   * Solde restant dû du dossier — somme des actes non annulés qui n'ont
   * jamais été réglés (aucune `LigneFacturation` à `PAYE`), y compris ceux
   * qui n'ont jamais été sélectionnés dans aucun cycle. Même formule que
   * `CareEpisodeService.calculerSoldeRestantDu` (dupliquée, comme les autres
   * ensembles de rôles/formules partagés dans ce projet — pas de dépendance
   * croisée entre les deux modules).
   */
  private async calculerSoldeRestantDu(dossierSoinsId: string): Promise<Decimal> {
    const actes = await this.prisma.acteDossier.findMany({
      where: { dossierSoinsId, deletedAt: null, statut: { not: 'ANNULE' } },
      include: {
        lignesFacturation: { where: { statut: 'PAYE' }, select: { id: true } },
      },
    });
    let solde = new Decimal(0);
    for (const acte of actes) {
      if (acte.lignesFacturation.length > 0) continue;
      solde = solde.add(
        new Decimal(acte.montantPrescrit?.toString() ?? '0').mul(acte.quantite),
      );
    }
    return solde;
  }

  /**
   * Fuite inter-adhérent corrigée (audit dashboard adhérent, même famille que
   * le fix reclamations du 2026-09-11) : cette méthode ne vérifiait QUE
   * `organisationId` — n'importe quel compte authentifié de l'organisation
   * (un AUTRE adhérent y compris) pouvait lire les montants, statut et
   * `adherentId` de N'IMPORTE QUELLE facture, seul `codeFacturation` étant
   * masqué. Désormais : l'adhérent propriétaire OU le personnel habilité à
   * générer/gérer les factures (`ROLES_GENERATION_FACTURE`, scopé à son
   * établissement pour le personnel de centre médical — même contrôle que
   * `genererFacture`/`ajouterActe`) ; tout autre appelant → 403.
   */
  async obtenirFacture(user: AuthenticatedUser, factureId: string) {
    const ctx = await this.contexteAppelant(user);
    const facture = await this.prisma.factureDossier.findFirst({
      where: {
        id: factureId,
        organisationId: ctx.organisationId,
        deletedAt: null,
      },
    });
    if (!facture) {
      throw new NotFoundException('Facture introuvable.');
    }

    const estLAdherent =
      !!ctx.adherentId && ctx.adherentId === facture.adherentId;
    const estStaffHabilite = ctx.roleChain.some((r) =>
      (ROLES_GENERATION_FACTURE as readonly string[]).includes(r),
    );
    const estCentreMedical = ctx.roleChain.some((r) =>
      (ROLES_CENTRE_MEDICAL as readonly string[]).includes(r),
    );
    if (
      estStaffHabilite &&
      estCentreMedical &&
      ctx.etablissementId !== facture.etablissementId
    ) {
      throw new ForbiddenException(
        "Vous n'appartenez pas à l'établissement de cette facture.",
      );
    }
    if (!estLAdherent && !estStaffHabilite) {
      throw new ForbiddenException('Cette facture ne vous concerne pas.');
    }

    // le code n'est visible que de l'adhérent (via listerMesFactures)
    const { codeFacturation, ...reste } = facture;
    return estLAdherent ? facture : reste;
  }

  /**
   * Montants (total / part assurance / part patient) pour un ENSEMBLE d'actes
   * déjà résolu comme facturable par l'appelant (`genererFactureSelection` a
   * déjà écarté les actes en attente/refusés de pré-autorisation et ceux déjà
   * réglés) — pure fonction de calcul, réutilisable pour n'importe quelle
   * sélection.
   */
  private async calculerMontantsPourActes(
    produitId: string,
    actes: { montantPrescrit: Prisma.Decimal | null; quantite: number; categorieActe: string }[],
  ): Promise<{ montantTotal: string; montantAssurance: string; montantPatient: string }> {
    const garanties = await this.prisma.garantie.findMany({
      where: { produitId, deletedAt: null },
    });
    const parCategorie = new Map(garanties.map((g) => [g.categorieActe, g]));

    let total = new Decimal(0);
    let assurance = new Decimal(0);
    for (const acte of actes) {
      const montant = new Decimal(acte.montantPrescrit?.toString() ?? '0').mul(
        acte.quantite,
      );
      total = total.add(montant);

      const g = parCategorie.get(acte.categorieActe);
      const taux = new Decimal(
        g?.tauxCouverture?.toString() ?? String(TAUX_COUVERTURE_DEFAUT),
      );
      let partAssurance = montant.mul(taux).div(100).toDecimalPlaces(2);
      if (g?.plafondParActe) {
        const plafond = new Decimal(g.plafondParActe.toString());
        if (partAssurance.gt(plafond)) partAssurance = plafond;
      }
      assurance = assurance.add(partAssurance);
    }

    const patient = total.sub(assurance);
    return {
      montantTotal: total.toFixed(2),
      montantAssurance: assurance.toFixed(2),
      montantPatient: patient.toFixed(2),
    };
  }

  private async genererCodeFacturationUnique(): Promise<string> {
    for (let tentative = 0; tentative < 6; tentative += 1) {
      const candidat = this.tirerCode();
      const existe = await this.prisma.factureDossier.findUnique({
        where: { codeFacturation: candidat },
      });
      if (!existe) {
        return candidat;
      }
    }
    throw new ConflictException(
      "Impossible de générer un code de facturation unique — réessayez.",
    );
  }

  private async genererCodeOrdonnanceUnique(): Promise<string> {
    for (let tentative = 0; tentative < 6; tentative += 1) {
      const candidat = this.tirerCode();
      const [ord, cons] = await Promise.all([
        this.prisma.codeOrdonnance.findUnique({ where: { code: candidat } }),
        this.prisma.codeConsultation.findUnique({ where: { code: candidat } }),
      ]);
      if (!ord && !cons) {
        return candidat;
      }
    }
    throw new ConflictException(
      "Impossible de générer un code unique — réessayez.",
    );
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
      etablissementId: profil.etablissementId,
      pharmacieId: profil.pharmacieId,
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
    tableCible = 'codes_consultation',
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
