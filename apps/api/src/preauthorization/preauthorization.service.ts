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
import { AjouterActeDto } from './dto/acte.dto';
import { ValiderCodeFacturationDto } from './dto/facture.dto';
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
  TAUX_COUVERTURE_DEFAUT,
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
          lignes: dto.lignes as unknown as Prisma.InputJsonValue,
          statut: 'ACTIVE',
        },
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
        lignes: ordonnance.lignes,
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
      include: { dossier: true },
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
        },
        'actes_dossier',
      );
      return acte.id;
    });

    return this.prisma.acteDossier.findUnique({ where: { id } });
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
   * Génère la facture d'un épisode : refuse si le ticket est encore OUVERT,
   * calcule les montants depuis les actes, émet le `code_facturation`. Le code
   * part vers l'ADHÉRENT (jamais l'établissement) ; il le récupère via
   * `GET /preauthorization/codes-facturation`.
   */
  async genererFacture(user: AuthenticatedUser, ticketSoinsId: string) {
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

    const ticket = await this.prisma.ticketSoins.findFirst({
      where: { id: ticketSoinsId },
      include: {
        dossier: { include: { police: true } },
        facture: true,
      },
    });
    if (!ticket || ticket.dossier.organisationId !== ctx.organisationId) {
      throw new NotFoundException('Ticket de soins introuvable.');
    }
    // Personnel de centre médical : uniquement les tickets de SON établissement
    // (même contrôle que l'ajout d'acte).
    const estCentreMedical = ctx.roleChain.some((r) =>
      (ROLES_CENTRE_MEDICAL as readonly string[]).includes(r),
    );
    if (
      estCentreMedical &&
      ctx.etablissementId !== ticket.dossier.etablissementId
    ) {
      throw new ForbiddenException(
        "Vous n'appartenez pas à l'établissement de ce ticket de soins.",
      );
    }
    if (ticket.statut === 'OUVERT') {
      throw new ConflictException(
        "Impossible de facturer : le ticket de soins est encore OUVERT. Il doit d'abord être clôturé.",
      );
    }
    if (ticket.statut === 'ANNULE') {
      throw new ConflictException(
        'Le ticket de soins est ANNULÉ — aucune facturation possible.',
      );
    }
    if (ticket.facture) {
      throw new ConflictException(
        'Une facture a déjà été générée pour ce ticket de soins.',
      );
    }

    const { montantTotal, montantAssurance, montantPatient } =
      await this.calculerMontants(ticket.dossier.police.produitId, ticketSoinsId);

    const code = await this.genererCodeFacturationUnique();

    const facture = await this.prisma.$transaction(async (tx) => {
      const f = await tx.factureDossier.create({
        data: {
          organisationId: ctx.organisationId,
          dossierSoinsId: ticket.dossierSoinsId,
          ticketSoinsId,
          etablissementId: ticket.dossier.etablissementId,
          adherentId: ticket.dossier.adherentId,
          beneficiaireId: ticket.dossier.beneficiaireId,
          montantTotal,
          montantAssurance,
          montantPatient,
          statut: 'EMISE',
          codeFacturation: code,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'GENERATION_CODE_FACTURATION',
        f.id,
        { ticketSoinsId, montantTotal, montantPatient },
        'factures_dossier',
      );
      return f;
    });

    // Réponse à l'ASSUREUR : montants, PAS le code.
    return {
      factureId: facture.id,
      statut: facture.statut,
      montantTotal: facture.montantTotal.toFixed(2),
      montantAssurance: facture.montantAssurance.toFixed(2),
      montantPatient: facture.montantPatient.toFixed(2),
      message:
        "Facture générée. Le code de facturation a été transmis à l'adhérent pour validation.",
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
      await this.audit(
        tx,
        ctx.userId,
        'CONFIRMATION_PAIEMENT_FACTURE',
        f.id,
        {
          montantAssurance: f.montantAssurance.toFixed(2),
          montantPatient: f.montantPatient.toFixed(2),
        },
        'factures_dossier',
      );
      return f;
    });

    return {
      factureId: maj.id,
      statut: maj.statut,
      montantAssurance: maj.montantAssurance.toFixed(2),
      montantPatient: maj.montantPatient.toFixed(2),
      dateReglement: maj.dateReglement,
    };
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

  /** Montants d'une facture — calcul provisoire (adjudication fine : Phase 7). */
  private async calculerMontants(
    produitId: string,
    ticketSoinsId: string,
  ): Promise<{
    montantTotal: string;
    montantAssurance: string;
    montantPatient: string;
  }> {
    const actes = await this.prisma.acteDossier.findMany({
      where: {
        ticketSoinsId,
        deletedAt: null,
        statut: { not: 'ANNULE' },
      },
    });
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
