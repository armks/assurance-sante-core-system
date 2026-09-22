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
import {
  AjouterActeDto,
  AutoriserRepetitionConsultationDto,
  AutoriserRepetitionDto,
  TraiterParExploitationDto,
  ValiderPreautorisationDto,
} from './dto/acte.dto';
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
  JOURS_ANTI_REPETITION,
  JOURS_FREQUENCE_CONSULTATION,
  LONGUEUR_CODE,
  ROLES_ADHERENT,
  ROLES_AJOUT_ACTE,
  ROLES_CENTRE_MEDICAL,
  ROLES_GENERATION_FACTURE,
  ROLES_PHARMACIE,
  ROLE_AUTORISATION_REPETITION,
  ROLE_CONFIRMATION_PAIEMENT,
  ROLE_MAINTENANCE_EXPIRATION,
  ROLE_MEDECIN_TRAITANT,
  ROLE_VALIDATION_PREAUTORISATION,
  ROLES_TRAITEMENT_EXPLOITATION,
  STATUTS_PREAUTORISATION_NON_FACTURABLES,
  TAUX_COUVERTURE_DEFAUT,
  TYPE_VISITE_ANTI_REPETITION,
  TYPES_VISITE_FREQUENCE_CONSULTATION,
  TYPES_VISITE_PREAUTORISATION_OBLIGATOIRE,
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
        "Ce code d'ordonnance a expiré (validité 14 jours).",
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

  /**
   * Expiration automatique des codes/ordonnances obsolètes — CONFIRMÉ ABSENT
   * au diagnostic (aucune tâche planifiée dans ce backend). Déclenchée à la
   * main pour l'instant, même pattern que `ProviderService.reverifierObsoletes`
   * (PROMPT 15) plutôt qu'une vraie infra @Cron/node-cron : pas de scheduler
   * existant dans ce backend, et un cron in-process poserait un risque réel
   * de double-exécution si l'API tourne un jour derrière plusieurs instances
   * (course-condition sans verrou distribué) — un endpoint idempotent,
   * déclenchable depuis un cron externe (ou manuellement), reste le choix le
   * plus sûr tant que l'architecture de déploiement n'impose pas mieux.
   * Idempotent : rejouer sans rien de nouveau à expirer ne fait rien
   * (`count` reflète alors 0).
   */
  async expirerOrdonnancesObsoletes(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_MAINTENANCE_EXPIRATION)) {
      throw new ForbiddenException(
        "Cette tâche de maintenance est réservée à ASSUREUR_INFORMATIQUE.",
      );
    }

    const maintenant = new Date();
    const [codes, ordonnances] = await this.prisma.$transaction([
      this.prisma.codeOrdonnance.updateMany({
        where: {
          organisationId: ctx.organisationId,
          statut: 'EMIS',
          dateExpiration: { lt: maintenant },
        },
        data: { statut: 'EXPIRE' },
      }),
      this.prisma.ordonnance.updateMany({
        where: {
          organisationId: ctx.organisationId,
          statut: { in: ['ACTIVE', 'PARTIELLEMENT_DELIVREE'] },
          dateValidite: { lt: maintenant },
          deletedAt: null,
        },
        data: { statut: 'EXPIREE' },
      }),
    ]);

    await this.audit(
      this.prisma,
      ctx.userId,
      'EXPIRATION_ORDONNANCES_OBSOLETES',
      ctx.organisationId,
      { codesExpires: codes.count, ordonnancesExpirees: ordonnances.count },
      'ordonnances',
    );

    return {
      codesExpires: codes.count,
      ordonnancesExpirees: ordonnances.count,
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

    // Règle anti-répétition (14 jours) — actes ajoutés dans un dossier
    // ANALYSES_EXAMENS_MEDICAUX uniquement, et seulement si un `codeActe` est
    // fourni (rien d'identifiable sinon, le même code désignant toujours le
    // même `referentiel_acte_id`). Patient du DOSSIER (adherent XOR
    // bénéficiaire), tous établissements confondus. Débloqué au cas par cas
    // par le médecin conseil (`autoriserRepetition`), jamais par l'exploitation
    // qui a rencontré le blocage.
    let autorisationRepetitionId: string | null = null;
    if (
      ticket.dossier.typeVisite === TYPE_VISITE_ANTI_REPETITION &&
      dto.codeActe
    ) {
      const patientFilter = ticket.dossier.adherentId
        ? { adherentId: ticket.dossier.adherentId }
        : ticket.dossier.beneficiaireId
          ? { beneficiaireId: ticket.dossier.beneficiaireId }
          : null;
      if (patientFilter) {
        const depuis = new Date();
        depuis.setDate(depuis.getDate() - JOURS_ANTI_REPETITION);
        const actePrecedent = await this.prisma.acteDossier.findFirst({
          where: {
            deletedAt: null,
            statut: { not: 'ANNULE' },
            codeActe: dto.codeActe,
            datePrescription: { gte: depuis },
            dossier: { organisationId: ctx.organisationId, ...patientFilter },
          },
          orderBy: { datePrescription: 'desc' },
        });
        if (actePrecedent) {
          const autorisation =
            await this.prisma.autorisationRepetitionActe.findFirst({
              where: {
                ticketSoinsId: ticket.id,
                codeActe: dto.codeActe,
                utilisee: false,
              },
            });
          if (!autorisation) {
            throw new ConflictException({
              message: `Un acte identique (code ${dto.codeActe}) a déjà été enregistré pour ce patient le ${actePrecedent.datePrescription.toLocaleDateString('fr-FR')} — moins de ${JOURS_ANTI_REPETITION} jours se sont écoulés. Une autorisation explicite du médecin conseil est requise pour resoumettre cet acte.`,
              acteRepeteDetecte: true,
              acteRepeteId: actePrecedent.id,
              dateActePrecedent: actePrecedent.datePrescription,
            });
          }
          autorisationRepetitionId = autorisation.id;
        }
      }
    }

    // Règle de fréquence des consultations (14 jours) — dossiers
    // CONSULTATION_GENERALISTE/CONSULTATION_SPECIALISTE, compteurs séparés
    // par type. Ne s'évalue qu'à l'ouverture de la consultation (premier acte
    // du ticket) : les actes suivants ajoutés à CE MÊME ticket font partie de
    // la même visite déjà admise, ils ne redéclenchent pas la règle. Débloqué
    // au cas par cas par le médecin conseil (`autoriserRepetitionConsultation`).
    let autorisationRepetitionConsultationId: string | null = null;
    if (
      ticket.dossier.typeVisite &&
      (TYPES_VISITE_FREQUENCE_CONSULTATION as readonly string[]).includes(
        ticket.dossier.typeVisite,
      )
    ) {
      const premierActeDuTicket =
        (await this.prisma.acteDossier.count({
          where: { ticketSoinsId: ticket.id, deletedAt: null },
        })) === 0;
      const patientFilterConsultation = ticket.dossier.adherentId
        ? { adherentId: ticket.dossier.adherentId }
        : ticket.dossier.beneficiaireId
          ? { beneficiaireId: ticket.dossier.beneficiaireId }
          : null;
      if (premierActeDuTicket && patientFilterConsultation) {
        const depuisConsultation = new Date();
        depuisConsultation.setDate(
          depuisConsultation.getDate() - JOURS_FREQUENCE_CONSULTATION,
        );
        const dossierPrecedent = await this.prisma.dossierSoins.findFirst({
          where: {
            id: { not: ticket.dossierSoinsId },
            deletedAt: null,
            typeVisite: ticket.dossier.typeVisite,
            organisationId: ctx.organisationId,
            dateOuverture: { gte: depuisConsultation },
            ...patientFilterConsultation,
          },
          orderBy: { dateOuverture: 'desc' },
        });
        if (dossierPrecedent) {
          const autorisationConsultation =
            await this.prisma.autorisationRepetitionActe.findFirst({
              where: {
                ticketSoinsId: ticket.id,
                typeVisite: ticket.dossier.typeVisite,
                utilisee: false,
              },
            });
          if (!autorisationConsultation) {
            throw new ConflictException({
              message: `Une consultation de type ${ticket.dossier.typeVisite} a déjà été enregistrée pour ce patient le ${dossierPrecedent.dateOuverture.toLocaleDateString('fr-FR')} — moins de ${JOURS_FREQUENCE_CONSULTATION} jours se sont écoulés. Une autorisation explicite du médecin conseil est requise pour ouvrir une nouvelle consultation de ce type.`,
              consultationRepeteeDetectee: true,
              dossierPrecedentId: dossierPrecedent.id,
              dateConsultationPrecedente: dossierPrecedent.dateOuverture,
            });
          }
          autorisationRepetitionConsultationId = autorisationConsultation.id;
        }
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

    // Pré-autorisation obligatoire à deux niveaux (analyses/examens,
    // hospitalisation) : décidée EXCLUSIVEMENT depuis le type de visite RÉEL
    // du dossier (jamais une valeur envoyée par le client) — v3 §5 étendu,
    // circuit à deux niveaux. Premier niveau = ASSUREUR_EXPLOITATION.
    const statutPreautorisation = (
      TYPES_VISITE_PREAUTORISATION_OBLIGATOIRE as readonly string[]
    ).includes(ticket.dossier.typeVisite ?? '')
      ? 'EN_ATTENTE_EXPLOITATION'
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
          autorisationRepetitionId,
          autorisationRepetitionConsultationId,
        },
        'actes_dossier',
      );
      if (autorisationRepetitionId) {
        await tx.autorisationRepetitionActe.update({
          where: { id: autorisationRepetitionId },
          data: { utilisee: true, utiliseeLe: new Date() },
        });
        await this.audit(
          tx,
          ctx.userId,
          'AJOUT_ACTE_REPETITION_AUTORISEE',
          acte.id,
          { ticketSoinsId: ticket.id, codeActe: dto.codeActe, autorisationRepetitionId },
          'actes_dossier',
        );
      }
      if (autorisationRepetitionConsultationId) {
        await tx.autorisationRepetitionActe.update({
          where: { id: autorisationRepetitionConsultationId },
          data: { utilisee: true, utiliseeLe: new Date() },
        });
        await this.audit(
          tx,
          ctx.userId,
          'AJOUT_ACTE_FREQUENCE_CONSULTATION_AUTORISEE',
          acte.id,
          {
            ticketSoinsId: ticket.id,
            typeVisite: ticket.dossier.typeVisite,
            autorisationRepetitionConsultationId,
          },
          'actes_dossier',
        );
      }
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
   *
   * `ticketModerateurOverride` : surcharge `garanties.ticketModerateur` pour
   * CE calcul précis — utilisé lors du recalcul après approbation par
   * l'exploitation/le médecin conseil quand `ticketModerateurAjuste` a été
   * renseigné sur l'acte (jamais la garantie elle-même, ni les autres actes
   * du dossier).
   */
  private async simulerMontantActe(
    organisationId: string,
    etablissementId: string,
    produitId: string,
    dto: Pick<AjouterActeDto, 'categorieActe' | 'codeActe' | 'montantPrescrit' | 'quantite'>,
    ticketModerateurOverride?: string,
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
    const ticketModPct = new Decimal(
      ticketModerateurOverride ?? garantie.ticketModerateur?.toString() ?? '0',
    );
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
   * Second niveau — décision du médecin conseil sur un acte ESCALADÉ par
   * l'exploitation (jamais atteint directement depuis l'ajout de l'acte
   * depuis ce Prompt : voir `traiterParExploitation`). Réservée EXCLUSIVEMENT
   * à ASSUREUR_MEDECIN_CONSEIL — pas ASSUREUR_INFORMATIQUE, pas
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

    const acte = await this.chargerActePreautorisation(ctx, acteId);
    if (acte.statutPreautorisation !== 'EN_ATTENTE_MEDECIN_CONSEIL') {
      throw new ConflictException(
        `Cet acte n'est pas en attente de validation par le médecin conseil (statut actuel : ${acte.statutPreautorisation}).`,
      );
    }

    return this.finaliserDecisionPreautorisation(ctx, acte, {
      decision: dto.decision,
      motif: dto.motif,
      action: 'PREAUTORISATION_ANALYSE',
      statutPrecedent: 'EN_ATTENTE_MEDECIN_CONSEIL',
    });
  }

  /**
   * Premier niveau de la pré-autorisation à deux niveaux — réservé
   * EXCLUSIVEMENT à ASSUREUR_EXPLOITATION/ASSUREUR_EXPLOITATION_CONJOINTE
   * (pas ASSUREUR_INFORMATIQUE, pas ASSUREUR_MEDECIN_CONSEIL).
   * `ESCALADE_MEDECIN_CONSEIL` transfère la décision au second niveau (file
   * existante du médecin conseil) sans statuer sur le fond ; `APPROUVE`/
   * `REFUSE` réutilisent le même mécanisme de finalisation que
   * `validerPreautorisation` (`finaliserDecisionPreautorisation`), avec en
   * plus l'approbation PARTIELLE (`quantiteApprouvee`/`typeApprouve`) et la
   * surcharge du ticket modérateur (`ticketModerateurAjuste`) propres à ce
   * niveau.
   */
  async traiterParExploitation(
    user: AuthenticatedUser,
    acteId: string,
    dto: TraiterParExploitationDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    if (
      !ctx.roleChain.some((r) =>
        (ROLES_TRAITEMENT_EXPLOITATION as readonly string[]).includes(r),
      )
    ) {
      throw new ForbiddenException(
        "Le traitement d'une pré-autorisation au premier niveau est réservé à ASSUREUR_EXPLOITATION ou ASSUREUR_EXPLOITATION_CONJOINTE.",
      );
    }

    const acte = await this.chargerActePreautorisation(ctx, acteId);
    if (acte.statutPreautorisation !== 'EN_ATTENTE_EXPLOITATION') {
      throw new ConflictException(
        `Cet acte n'est pas en attente de traitement par l'exploitation (statut actuel : ${acte.statutPreautorisation}).`,
      );
    }

    // Orientation : l'établissement EXÉCUTANT doit exister dans l'organisation
    // (mais peut être différent de celui d'origine — c'est tout le sens de la
    // réorientation).
    if (dto.etablissementExecutionId) {
      const etablissementExecution = await this.prisma.etablissementSante.findFirst({
        where: {
          id: dto.etablissementExecutionId,
          organisationId: ctx.organisationId,
          deletedAt: null,
        },
      });
      if (!etablissementExecution) {
        throw new NotFoundException(
          "Établissement exécutant introuvable ou hors de votre réseau.",
        );
      }
    }

    if (dto.decision === 'ESCALADE_MEDECIN_CONSEIL') {
      await this.prisma.$transaction(async (tx) => {
        await tx.acteDossier.update({
          where: { id: acteId },
          data: { statutPreautorisation: 'EN_ATTENTE_MEDECIN_CONSEIL' },
        });
        await this.audit(
          tx,
          ctx.userId,
          'ESCALADE_PREAUTORISATION_MEDECIN_CONSEIL',
          acteId,
          { motif: dto.motif, statutPrecedent: 'EN_ATTENTE_EXPLOITATION' },
          'actes_dossier',
        );
      });
      return this.prisma.acteDossier.findUnique({ where: { id: acteId } });
    }

    return this.finaliserDecisionPreautorisation(ctx, acte, {
      decision: dto.decision,
      quantiteApprouvee: dto.quantiteApprouvee,
      typeApprouve: dto.typeApprouve,
      ticketModerateurAjuste: dto.ticketModerateurAjuste,
      etablissementExecutionId: dto.etablissementExecutionId,
      motif: dto.motif,
      action: 'PREAUTORISATION_EXPLOITATION',
      statutPrecedent: 'EN_ATTENTE_EXPLOITATION',
    });
  }

  /**
   * Cœur partagé entre `validerPreautorisation` (médecin conseil, second
   * niveau) et `traiterParExploitation` (premier niveau, décisions APPROUVE/
   * REFUSE) : détermine le statut final (`APPROUVEE`/`APPROUVEE_
   * PARTIELLEMENT`/`REFUSEE`), recalcule la simulation indicative sur la base
   * RÉELLEMENT approuvée quand elle diffère de la demande initiale, puis
   * persiste + audite.
   */
  private async finaliserDecisionPreautorisation(
    ctx: ContexteAppelant,
    acte: {
      id: string;
      quantite: number;
      libelle: string;
      categorieActe: string;
      codeActe: string | null;
      montantPrescrit: Prisma.Decimal | null;
      dossier: { etablissementId: string; police: { produitId: string } };
    },
    params: {
      decision: 'APPROUVE' | 'REFUSE';
      quantiteApprouvee?: number;
      typeApprouve?: string;
      ticketModerateurAjuste?: number;
      etablissementExecutionId?: string;
      motif: string;
      action: string;
      statutPrecedent: string;
    },
  ) {
    let nouveauStatut: string;
    let simulation: {
      montantSimuleAssurance: string;
      montantSimulePatient: string;
      ticketModerateurSimule: string;
    } | null = null;

    if (params.decision === 'REFUSE') {
      nouveauStatut = 'REFUSEE';
    } else {
      nouveauStatut = this.estApprobationPartielle(acte, params)
        ? 'APPROUVEE_PARTIELLEMENT'
        : 'APPROUVEE';

      if (acte.montantPrescrit !== null) {
        // Orientation (v3 §5 complément) : le tarif conventionné se recherche
        // pour l'établissement EXÉCUTANT une fois renseigné, plus jamais
        // celui d'origine du dossier.
        simulation = await this.simulerMontantActe(
          ctx.organisationId,
          params.etablissementExecutionId ?? acte.dossier.etablissementId,
          acte.dossier.police.produitId,
          {
            categorieActe: acte.categorieActe as AjouterActeDto['categorieActe'],
            codeActe: acte.codeActe ?? undefined,
            montantPrescrit: Number(acte.montantPrescrit.toString()),
            quantite: params.quantiteApprouvee ?? acte.quantite,
          },
          params.ticketModerateurAjuste !== undefined
            ? params.ticketModerateurAjuste.toFixed(2)
            : undefined,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.acteDossier.update({
        where: { id: acte.id },
        data: {
          statutPreautorisation: nouveauStatut,
          ...(params.decision === 'APPROUVE'
            ? {
                quantiteApprouvee: params.quantiteApprouvee ?? null,
                typeActeApprouve: params.typeApprouve ?? null,
                ticketModerateurAjuste:
                  params.ticketModerateurAjuste !== undefined
                    ? params.ticketModerateurAjuste.toFixed(2)
                    : null,
                etablissementExecutionId: params.etablissementExecutionId ?? null,
                ...(simulation
                  ? {
                      montantSimuleAssurance: simulation.montantSimuleAssurance,
                      montantSimulePatient: simulation.montantSimulePatient,
                      ticketModerateurSimule: simulation.ticketModerateurSimule,
                    }
                  : {}),
              }
            : {}),
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        params.action,
        acte.id,
        {
          decision: params.decision,
          motif: params.motif,
          quantiteApprouvee: params.quantiteApprouvee ?? null,
          typeApprouve: params.typeApprouve ?? null,
          ticketModerateurAjuste: params.ticketModerateurAjuste ?? null,
          etablissementExecutionId: params.etablissementExecutionId ?? null,
          statutPrecedent: params.statutPrecedent,
          nouveauStatut,
          simulationRecalculee: simulation ?? null,
        },
        'actes_dossier',
      );
    });

    return this.prisma.acteDossier.findUnique({ where: { id: acte.id } });
  }

  /**
   * Une approbation est PARTIELLE dès que la quantité réellement approuvée
   * est INFÉRIEURE à la quantité demandée (`acte.quantite`, inchangée), ou
   * que la nature de l'acte approuvé diffère du libellé initialement demandé
   * (ex. « mise en observation » à la place d'une hospitalisation).
   */
  private estApprobationPartielle(
    acte: { quantite: number; libelle: string },
    params: { quantiteApprouvee?: number; typeApprouve?: string },
  ): boolean {
    if (
      params.quantiteApprouvee !== undefined &&
      params.quantiteApprouvee < acte.quantite
    ) {
      return true;
    }
    if (
      params.typeApprouve !== undefined &&
      params.typeApprouve.trim() !== '' &&
      params.typeApprouve.trim() !== acte.libelle
    ) {
      return true;
    }
    return false;
  }

  /** Charge un acte pour le circuit de pré-autorisation, scopé organisation. */
  private async chargerActePreautorisation(
    ctx: ContexteAppelant,
    acteId: string,
  ) {
    const acte = await this.prisma.acteDossier.findFirst({
      where: { id: acteId, deletedAt: null },
      include: {
        dossier: {
          select: {
            organisationId: true,
            etablissementId: true,
            police: { select: { produitId: true } },
          },
        },
      },
    });
    if (!acte || acte.dossier.organisationId !== ctx.organisationId) {
      throw new NotFoundException('Acte introuvable.');
    }
    return acte;
  }

  /**
   * File d'attente du médecin conseil — actes ESCALADÉS par l'exploitation
   * (second niveau uniquement depuis ce Prompt), organisation entière (rôle
   * ASSUREUR non scopé à un établissement, même pattern que les autres files
   * ASSUREUR_*).
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
        statutPreautorisation: 'EN_ATTENTE_MEDECIN_CONSEIL',
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

  /**
   * File de l'exploitation — TOUS les actes concernés par le circuit de
   * pré-autorisation (en attente de son propre traitement, escaladés au
   * médecin conseil en lecture seule, ou déjà tranchés), organisation
   * entière, du plus récent au plus ancien. Le frontend répartit en 3
   * sections (Propositions à valider / Transmis au médecin conseil / Actes
   * traités) depuis `statutPreautorisation` — un seul aller-retour.
   * `dossierId` permet l'accès au dossier complet du patient (établissement,
   * historique) avant décision, via l'écran dossiers déjà partagé avec
   * ASSUREUR_EXPLOITATION (`ROLES_LECTURE_DOSSIER_STAFF`).
   */
  async listerActesPreautorisationExploitation(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    if (
      !ctx.roleChain.some((r) =>
        (ROLES_TRAITEMENT_EXPLOITATION as readonly string[]).includes(r),
      )
    ) {
      throw new ForbiddenException(
        'Réservé exclusivement à ASSUREUR_EXPLOITATION ou ASSUREUR_EXPLOITATION_CONJOINTE.',
      );
    }

    const actes = await this.prisma.acteDossier.findMany({
      where: {
        statutPreautorisation: { not: 'NON_REQUISE' },
        deletedAt: null,
        dossier: { organisationId: ctx.organisationId },
      },
      include: {
        dossier: {
          select: {
            id: true,
            numeroTraitement: true,
            typeVisite: true,
            etablissement: { select: { nom: true } },
            adherent: { select: { nom: true, prenom: true } },
            beneficiaire: { select: { nom: true, prenom: true } },
          },
        },
        etablissementExecution: { select: { nom: true } },
      },
      orderBy: { datePrescription: 'desc' },
    });

    return actes.map((a) => ({
      id: a.id,
      libelle: a.libelle,
      categorieActe: a.categorieActe,
      codeActe: a.codeActe,
      quantite: a.quantite,
      quantiteApprouvee: a.quantiteApprouvee,
      typeActeApprouve: a.typeActeApprouve,
      ticketModerateurAjuste: a.ticketModerateurAjuste?.toFixed(2) ?? null,
      montantPrescrit: a.montantPrescrit?.toFixed(2) ?? null,
      montantSimuleAssurance: a.montantSimuleAssurance?.toFixed(2) ?? null,
      montantSimulePatient: a.montantSimulePatient?.toFixed(2) ?? null,
      ticketModerateurSimule: a.ticketModerateurSimule?.toFixed(2) ?? null,
      statutPreautorisation: a.statutPreautorisation,
      datePrescription: a.datePrescription,
      dossierId: a.dossier.id,
      numeroTraitement: a.dossier.numeroTraitement,
      typeVisite: a.dossier.typeVisite,
      etablissement: a.dossier.etablissement.nom,
      etablissementExecution: a.etablissementExecution?.nom ?? null,
      patient: a.dossier.adherent
        ? `${a.dossier.adherent.prenom} ${a.dossier.adherent.nom}`
        : a.dossier.beneficiaire
          ? `${a.dossier.beneficiaire.prenom} ${a.dossier.beneficiaire.nom}`
          : '—',
    }));
  }

  /**
   * Débloque, une seule fois, la règle anti-répétition (14 jours) pour un
   * acte ANALYSES_EXAMENS_MEDICAUX précis (même `codeActe`) sur CE ticket de
   * soins — réservé exclusivement à ASSUREUR_MEDECIN_CONSEIL (jamais
   * l'exploitation, qui est celle qui rencontre le blocage).
   */
  async autoriserRepetition(
    user: AuthenticatedUser,
    ticketSoinsId: string,
    dto: AutoriserRepetitionDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_AUTORISATION_REPETITION)) {
      throw new ForbiddenException(
        'Le déblocage de la règle anti-répétition est réservé exclusivement à ASSUREUR_MEDECIN_CONSEIL.',
      );
    }
    const ticket = await this.chargerTicket(ctx.organisationId, ticketSoinsId);

    const autorisation = await this.prisma.$transaction(async (tx) => {
      const cree = await tx.autorisationRepetitionActe.create({
        data: {
          organisationId: ctx.organisationId,
          ticketSoinsId: ticket.id,
          codeActe: dto.codeActe,
          motif: dto.motif,
          autoriseParId: ctx.userId,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'AUTORISATION_REPETITION_ACTE',
        cree.id,
        { ticketSoinsId: ticket.id, codeActe: dto.codeActe, motif: dto.motif },
        'autorisations_repetition_acte',
      );
      return cree;
    });

    return autorisation;
  }

  /**
   * Débloque, une seule fois, la règle de fréquence des consultations
   * (14 jours) pour un TYPE de visite précis (généraliste ou spécialiste) sur
   * CE ticket de soins — réservé exclusivement à ASSUREUR_MEDECIN_CONSEIL
   * (jamais l'exploitation).
   */
  async autoriserRepetitionConsultation(
    user: AuthenticatedUser,
    ticketSoinsId: string,
    dto: AutoriserRepetitionConsultationDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_AUTORISATION_REPETITION)) {
      throw new ForbiddenException(
        'Le déblocage de la règle de fréquence des consultations est réservé exclusivement à ASSUREUR_MEDECIN_CONSEIL.',
      );
    }
    const ticket = await this.chargerTicket(ctx.organisationId, ticketSoinsId);

    const autorisation = await this.prisma.$transaction(async (tx) => {
      const cree = await tx.autorisationRepetitionActe.create({
        data: {
          organisationId: ctx.organisationId,
          ticketSoinsId: ticket.id,
          typeVisite: dto.typeVisite,
          motif: dto.motif,
          autoriseParId: ctx.userId,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'AUTORISATION_FREQUENCE_CONSULTATION',
        cree.id,
        { ticketSoinsId: ticket.id, typeVisite: dto.typeVisite, motif: dto.motif },
        'autorisations_repetition_acte',
      );
      return cree;
    });

    return autorisation;
  }

  /**
   * Statistiques /dashboard-assureur/exploitation — comptes d'actes du
   * circuit de pré-autorisation par période (jour/semaine/mois/année) et par
   * issue (approuvés = APPROUVEE(_PARTIELLEMENT), refusés, escaladés =
   * ACTUELLEMENT en file du médecin conseil). Simple agrégation sur
   * `statutPreautorisation`/`updatedAt` (date de la dernière décision) —
   * aucune nouvelle table, aucune date de décision dédiée.
   */
  async statistiquesExploitation(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    if (
      !ctx.roleChain.some((r) =>
        (ROLES_TRAITEMENT_EXPLOITATION as readonly string[]).includes(r),
      )
    ) {
      throw new ForbiddenException(
        'Réservé exclusivement à ASSUREUR_EXPLOITATION ou ASSUREUR_EXPLOITATION_CONJOINTE.',
      );
    }

    const maintenant = new Date();
    const debutJour = new Date(
      Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate()),
    );
    const jourSemaine = debutJour.getUTCDay(); // 0=dimanche .. 6=samedi
    const decalageLundi = jourSemaine === 0 ? 6 : jourSemaine - 1;
    const debutSemaine = new Date(debutJour);
    debutSemaine.setUTCDate(debutSemaine.getUTCDate() - decalageLundi);
    const debutMois = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1));
    const debutAnnee = new Date(Date.UTC(maintenant.getUTCFullYear(), 0, 1));

    const actes = await this.prisma.acteDossier.findMany({
      where: {
        deletedAt: null,
        statutPreautorisation: {
          in: ['APPROUVEE', 'APPROUVEE_PARTIELLEMENT', 'REFUSEE', 'EN_ATTENTE_MEDECIN_CONSEIL'],
        },
        updatedAt: { gte: debutAnnee },
        dossier: { organisationId: ctx.organisationId },
      },
      select: { statutPreautorisation: true, updatedAt: true },
    });

    const compteurVide = () => ({ approuves: 0, refuses: 0, escalades: 0 });
    const stats = {
      jour: compteurVide(),
      semaine: compteurVide(),
      mois: compteurVide(),
      annee: compteurVide(),
    };

    for (const acte of actes) {
      const cle: 'approuves' | 'refuses' | 'escalades' =
        acte.statutPreautorisation === 'REFUSEE'
          ? 'refuses'
          : acte.statutPreautorisation === 'EN_ATTENTE_MEDECIN_CONSEIL'
            ? 'escalades'
            : 'approuves';
      stats.annee[cle] += 1;
      if (acte.updatedAt >= debutMois) stats.mois[cle] += 1;
      if (acte.updatedAt >= debutSemaine) stats.semaine[cle] += 1;
      if (acte.updatedAt >= debutJour) stats.jour[cle] += 1;
    }

    return stats;
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
   * - tout acte encore `EN_ATTENTE_EXPLOITATION`/`EN_ATTENTE_MEDECIN_CONSEIL`/
   *   `REFUSEE` en pré-autorisation (garde posée pour les analyses/examens
   *   médicaux et les hospitalisations, circuit à deux niveaux) ;
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
