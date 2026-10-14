import { randomInt } from 'node:crypto';
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
  AjouterConsultationDto,
  AjouterNoteDto,
  ClotureDto,
  ClotureForceeDto,
  DefinirTypeVisiteDto,
  OuvrirDossierDto,
} from './dto/care-episode.dto';
import {
  ContexteAppelant,
  EvaluationOuverture,
  ROLE_CLOTURE_FORCEE,
  ROLE_MEDECIN_TRAITANT,
  ROLES_CENTRE_MEDICAL,
  ROLES_ECRITURE_NOTE_DOSSIER,
  ROLES_GESTION_DOSSIER,
  ROLES_LECTURE_DOSSIER_STAFF,
} from './care-episode.types';

/** Mode de lecture résolu par `modeLectureDossiers()` — voir son commentaire. */
type ModeLectureDossiers = 'STAFF' | 'CENTRE_MEDICAL';

type Db = PrismaService | Prisma.TransactionClient;

/** Alphabet du code de ticket — sans caractères ambigus (cf. codes anti-fraude). */
const ALPHABET_TICKET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

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
    // Le patient appartient TOUJOURS à l'organisation de l'appelant — contrôlé
    // ici, à la source, quel que soit l'appelant (aujourd'hui la seule voie est
    // `validerCodeConsultation`, qui passe le patient du code : la protection
    // ne doit pas en dépendre).
    await this.assertPatientDeLOrganisation(ctx.organisationId, dto);

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

    const evaluation = await this.evaluerOuverture(ctx.organisationId, dto, etablissement, police);

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
    const codeTicket = await this.genererCodeTicketUnique();

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
          carteValide: evaluation.carteValide,
          adherentEligible: evaluation.adherentEligible,
          aucunDossierOuvert: evaluation.aucunDossierOuvert,
          horsDelaiCarence: evaluation.horsDelaiCarence,
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

      // Ticket de Soins — créé AUTOMATIQUEMENT, dans CETTE transaction (v8 §4).
      const ticket = await tx.ticketSoins.create({
        data: {
          dossierSoinsId: dossier.id,
          // Dénormalisé depuis le dossier de soins à la création : permet une
          // policy RLS d'isolation tenant vérifiable directement sur la table
          // (le trigger `tickets_soins_set_organisation_id` la refige de toute
          // façon depuis le dossier — défense en profondeur).
          organisationId: ctx.organisationId,
          code: codeTicket,
          statut: 'OUVERT',
        },
      });

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
          ticketSoinsId: ticket.id,
        },
      );
      await this.audit(
        tx,
        ctx.userId,
        'OUVERTURE_TICKET_SOINS',
        ticket.id,
        { dossierSoinsId: dossier.id },
        'tickets_soins',
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
    return this.evaluerOuverture(organisationId, params, etablissement, police);
  }

  /** Évaluation pure (MoteurOuvertureDossier) — testable et réutilisable. */
  private async evaluerOuverture(
    organisationId: string,
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
    // Recherche NON limitée à l'organisation : l'unicité « un seul dossier
    // ouvert par patient » est globale (index partiel en base). Mais le numéro
    // du dossier n'est cité que s'il appartient à l'organisation de l'appelant.
    const dossierOuvert = await this.prisma.dossierSoins.findFirst({
      where: { ...patientWhere, statut: 'OUVERT', deletedAt: null },
      select: { numeroTraitement: true, organisationId: true },
    });
    const aucunDossierOuvert = !dossierOuvert;
    if (dossierOuvert) {
      const reference = dossierOuvert.organisationId === organisationId ? ` (${dossierOuvert.numeroTraitement})` : '';
      blocages.push(
        `Un dossier de soins est déjà ouvert pour ce patient${reference}. Il doit être clôturé avant d'en ouvrir un nouveau.`,
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

    // 5. Adhérent / bénéficiaire réellement ACTIF (PROMPT 12).
    //    On vérifie désormais le STATUT réel dans le fichier des membres —
    //    plus le raccourci « éligible dès que la carte est valide ». Un adhérent
    //    SUSPENDU ou RADIE ne peut pas ouvrir de dossier de soins.
    const adherentEligible = await this.evaluerEligibiliteMembre(organisationId, dto, blocages);

    return {
      carteValide,
      adherentEligible,
      aucunDossierOuvert,
      horsDelaiCarence,
      blocages,
    };
  }

  /**
   * Le patient (adhérent, ou bénéficiaire via son adhérent titulaire) existe
   * DANS l'organisation de l'appelant. Même réponse qu'il soit inconnu ou
   * rattaché à une autre organisation : rien n'est révélé sur les autres.
   */
  private async assertPatientDeLOrganisation(
    organisationId: string,
    dto: { adherentId?: string; beneficiaireId?: string },
  ): Promise<void> {
    const trouve = dto.adherentId
      ? await this.prisma.adherent.findFirst({
          where: { id: dto.adherentId, organisationId, deletedAt: null },
          select: { id: true },
        })
      : await this.prisma.beneficiaire.findFirst({
          where: { id: dto.beneficiaireId, deletedAt: null, adherent: { organisationId } },
          select: { id: true },
        });
    if (!trouve) {
      throw new NotFoundException('Patient introuvable dans votre organisation.');
    }
  }

  /**
   * Statut du membre (adhérent titulaire ou bénéficiaire) dans le fichier des
   * membres. `ACTIF` requis ; pour un bénéficiaire, l'adhérent titulaire doit
   * lui aussi être `ACTIF`. Ajoute un blocage précis sinon (v1 §15.4).
   */
  private async evaluerEligibiliteMembre(
    organisationId: string,
    dto: { adherentId?: string; beneficiaireId?: string },
    blocages: string[],
  ): Promise<boolean> {
    if (dto.beneficiaireId) {
      const benef = await this.prisma.beneficiaire.findFirst({
        where: { id: dto.beneficiaireId, deletedAt: null, adherent: { organisationId } },
        select: { statut: true, adherent: { select: { statut: true } } },
      });
      if (!benef) {
        blocages.push('Bénéficiaire inconnu dans le fichier des membres.');
        return false;
      }
      if (benef.statut !== 'ACTIF') {
        blocages.push(
          `Bénéficiaire non éligible : statut « ${benef.statut} » (ACTIF requis).`,
        );
        return false;
      }
      if (benef.adherent.statut !== 'ACTIF') {
        blocages.push(
          `Bénéficiaire non éligible : l'adhérent titulaire est « ${benef.adherent.statut} » (ACTIF requis).`,
        );
        return false;
      }
      return true;
    }

    if (dto.adherentId) {
      const adherent = await this.prisma.adherent.findFirst({
        where: { id: dto.adherentId, organisationId, deletedAt: null },
        select: { statut: true },
      });
      if (!adherent) {
        blocages.push('Adhérent inconnu dans le fichier des membres.');
        return false;
      }
      if (adherent.statut !== 'ACTIF') {
        blocages.push(
          `Adhérent non éligible : statut « ${adherent.statut} » (ACTIF requis).`,
        );
        return false;
      }
      return true;
    }

    blocages.push('Aucun patient identifié (adhérent ou bénéficiaire requis).');
    return false;
  }

  // --- Médecins de l'établissement -------------------------------

  /**
   * Médecins (CENTRE_MEDICAL_MEDECIN) de l'établissement de l'appelant, dont le NOM est renseigné (pseudo du profil ;
   * le médecin doit donc créer son profil pour apparaître). Réservé au personnel du centre : un compte sans établissement ou hors centre médical n'a rien à désigner (403).
   */
  async listerMedecinsEtablissement(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    const estCentreMedical = ctx.roleChain.some((code) =>
      (ROLES_CENTRE_MEDICAL as readonly string[]).includes(code),
    );
    if (!estCentreMedical || !ctx.etablissementId) {
      throw new ForbiddenException("La liste des médecins est réservée au personnel d'un centre médical.");
    }
    // Seuls les médecins qui ont renseigné leur nom (pseudo de « Mon profil ») sont proposés : jamais d'e-mail dans la liste.
    const profils = await this.prisma.profil.findMany({
      where: {
        organisationId: ctx.organisationId,
        etablissementId: ctx.etablissementId,
        role: ROLE_MEDECIN_TRAITANT,
        deletedAt: null,
        statut: 'ACTIF',
        pseudo: { not: null },
      },
      select: { id: true, pseudo: true },
    });
    return profils
      .map((p) => ({ id: p.id, libelle: (p.pseudo ?? '').trim() }))
      .filter((m) => m.libelle)
      .sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'));
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
    this.assertEtablissementDossier(ctx, dossier);
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

  /**
   * Choisit le type de visite — UNE SEULE FOIS, à l'intérieur du dossier,
   * après son ouverture (l'ouverture reste conditionnée au seul code de
   * consultation, inchangée). Refuse (409) si déjà choisi : passer par un
   * nouveau dossier plutôt que de corriger silencieusement une erreur de
   * saisie déjà tracée.
   */
  async definirTypeVisite(
    user: AuthenticatedUser,
    dossierId: string,
    dto: DefinirTypeVisiteDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

    const dossier = await this.chargerDossierBrut(ctx.organisationId, dossierId);
    this.assertEtablissementDossier(ctx, dossier);
    if (dossier.statut !== 'OUVERT') {
      throw new ConflictException(
        `On ne peut choisir le type de visite que sur un dossier OUVERT (statut actuel : ${dossier.statut}).`,
      );
    }
    if (dossier.typeVisite) {
      throw new ConflictException(
        `Le type de visite est déjà défini pour ce dossier (${dossier.typeVisite}).`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.dossierSoins.update({
        where: { id: dossierId },
        data: { typeVisite: dto.typeVisite },
      });
      await this.audit(
        tx,
        ctx.userId,
        'DEFINITION_TYPE_VISITE',
        dossierId,
        { typeVisite: dto.typeVisite },
        'dossiers_soins',
      );
    });

    return this.chargerDossierBrut(ctx.organisationId, dossierId);
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
    this.assertEtablissementDossier(ctx, dossier);
    if (!['OUVERT', 'SUSPENDU'].includes(dossier.statut)) {
      throw new ConflictException(
        `Ce dossier ne peut pas être clôturé (statut actuel : ${dossier.statut}).`,
      );
    }
    await this.assertSolde(dossierId);
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
    await this.assertSolde(dossierId);
    return this.appliquerCloture(
      ctx,
      dossierId,
      'FORCE_CLOS',
      'FORCEE',
      dto.motif,
    );
  }

  /**
   * REFUSE explicitement toute clôture (normale OU forcée) tant que le
   * dossier n'est pas intégralement soldé — décision actée : un dossier reste
   * ouvert indéfiniment tant qu'il n'est pas soldé, même si cela bloque un
   * futur dossier pour ce patient (contrainte « aucun dossier déjà ouvert »,
   * v1 §15.4, déjà en place).
   */
  private async assertSolde(dossierId: string): Promise<void> {
    const solde = await this.calculerSoldeRestantDu(dossierId);
    if (solde.gt(0)) {
      throw new ConflictException(
        `Clôture impossible : il reste ${solde.toFixed(2)} F à régler sur ce dossier. ` +
          "Réglez le solde restant (facturation par sélection d'actes) avant de clôturer.",
      );
    }
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

      // Ticket de Soins — clôturé AUTOMATIQUEMENT, dans CETTE transaction :
      // verrouille définitivement l'ajout d'actes (v8 §4).
      const ticket = await tx.ticketSoins.updateMany({
        where: { dossierSoinsId: dossierId, statut: 'OUVERT' },
        data: { statut: 'CLOTURE', dateCloture: new Date() },
      });

      await this.audit(
        tx,
        ctx.userId,
        clotureType === 'FORCEE'
          ? 'CLOTURE_FORCEE_DOSSIER_SOINS'
          : 'CLOTURE_DOSSIER_SOINS',
        dossierId,
        { motif: motif ?? null, ticketCloture: ticket.count },
      );
    });
    return this.chargerDossier(ctx.organisationId, dossierId);
  }

  // --- Lecture --------------------------------------------

  /**
   * Fuite inter-établissement corrigée (audit dashboard administratif) :
   * `listerDossiers`/`obtenirDossier` ne vérifiaient QUE `organisationId` —
   * aucune restriction de rôle NI d'établissement. N'importe quel compte
   * authentifié de l'organisation (un adhérent, une pharmacie, un autre
   * établissement du réseau…) pouvait lire n'importe quel dossier de soins
   * (diagnostic, motif de consultation — données de santé). Désormais : le
   * personnel ASSUREUR habilité lit toute l'organisation (supervision/revue
   * médicale) ; le personnel CENTRE_MEDICAL ne lit que les dossiers de SON
   * PROPRE établissement ; tout autre appelant → 403.
   */
  private modeLectureDossiers(ctx: ContexteAppelant): ModeLectureDossiers {
    const estStaff = ctx.roleChain.some((code) =>
      (ROLES_LECTURE_DOSSIER_STAFF as readonly string[]).includes(code),
    );
    if (estStaff) return 'STAFF';

    const estCentreMedical = ctx.roleChain.some((code) =>
      (ROLES_CENTRE_MEDICAL as readonly string[]).includes(code),
    );
    if (estCentreMedical && ctx.etablissementId) return 'CENTRE_MEDICAL';

    throw new ForbiddenException(
      'Rôle insuffisant : la consultation des dossiers de soins est réservée au personnel ASSUREUR habilité (direction, exploitation, informatique, médecin-conseil) ou au personnel de l’établissement concerné.',
    );
  }

  async listerDossiers(
    user: AuthenticatedUser,
    filtres: { statut?: string; etablissementId?: string },
  ) {
    const ctx = await this.contexteAppelant(user);
    const mode = this.modeLectureDossiers(ctx);
    return this.prisma.dossierSoins.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(filtres.statut ? { statut: filtres.statut } : {}),
        ...(filtres.etablissementId
          ? { etablissementId: filtres.etablissementId }
          : {}),
        // Le scope CENTRE_MEDICAL écrase tout etablissementId fourni par le
        // client : impossible d'élargir sa lecture à un autre établissement.
        ...(mode === 'CENTRE_MEDICAL' && ctx.etablissementId
          ? { etablissementId: ctx.etablissementId }
          : {}),
      },
      include: { etablissement: { select: { nom: true } } },
      orderBy: { dateOuverture: 'desc' },
    });
  }

  async obtenirDossier(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    const mode = this.modeLectureDossiers(ctx);
    const dossier = await this.chargerDossier(
      ctx.organisationId,
      id,
      mode === 'CENTRE_MEDICAL' ? ctx.etablissementId : null,
    );
    const soldeRestantDu = await this.calculerSoldeRestantDu(id);
    return { ...dossier, soldeRestantDu: soldeRestantDu.toFixed(2) };
  }

  /**
   * Solde restant dû du dossier — somme des actes non annulés qui n'ont
   * jamais été réglés (aucune `LigneFacturation` à `PAYE`), qu'ils aient déjà
   * été sélectionnés dans un cycle A_PAYER ou jamais sélectionnés du tout.
   * Facturation par sélection d'actes, paiement partiel (prisma/sql/039) :
   * un dossier peut désormais avoir plusieurs cycles de facturation
   * successifs, la clôture reste GELÉE tant que ce solde n'est pas à zéro
   * (décision actée : même si cela bloque un futur dossier pour ce patient,
   * cf. la contrainte d'unicité « aucun dossier déjà ouvert » déjà en place).
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
      if (acte.lignesFacturation.length > 0) continue; // déjà réglé
      solde = solde.add(
        new Decimal(acte.montantPrescrit?.toString() ?? '0').mul(acte.quantite),
      );
    }
    return solde;
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
      etablissementId: profil.etablissementId ?? null,
    };
  }

  /**
   * Fuite inter-établissement corrigée (audit dashboard administratif) :
   * `ajouterConsultation`/`clotureNormale` ne vérifiaient QUE `organisationId`
   * sur le dossier — jamais que l'APPELANT (et pas seulement le médecin
   * référencé) appartenait à l'établissement du dossier. Un compte
   * CENTRE_MEDICAL_* de n'importe quel établissement du réseau pouvait ainsi
   * clôturer ou modifier le dossier d'un AUTRE établissement.
   */
  private assertEtablissementDossier(
    ctx: ContexteAppelant,
    dossier: { etablissementId: string },
  ): void {
    const estCentreMedical = ctx.roleChain.some((code) =>
      (ROLES_CENTRE_MEDICAL as readonly string[]).includes(code),
    );
    if (estCentreMedical && ctx.etablissementId !== dossier.etablissementId) {
      throw new ForbiddenException(
        "Vous n'appartenez pas à l'établissement de ce dossier de soins.",
      );
    }
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

  private async chargerDossier(
    organisationId: string,
    id: string,
    etablissementId?: string | null,
  ) {
    const dossier = await this.prisma.dossierSoins.findFirst({
      where: {
        id,
        organisationId,
        deletedAt: null,
        ...(etablissementId ? { etablissementId } : {}),
      },
      include: {
        etablissement: { select: { nom: true } },
        consultations: {
          where: { deletedAt: null },
          orderBy: { dateConsultation: 'asc' },
        },
        // `ticket.factures` : la vue comptable du centre affiche l'historique
        // des cycles de facturation (montants, validation patient) sans
        // endpoint dédié. Le `code_facturation` reste EXCLU — il n'est
        // visible que de l'adhérent (anti-fraude v8 §5). Plusieurs cycles
        // possibles depuis prisma/sql/039 (facturation par sélection d'actes,
        // paiement partiel) — d'où la liste, triée du plus récent au plus ancien.
        ticket: {
          include: {
            factures: {
              select: {
                id: true,
                ticketSoinsId: true,
                montantTotal: true,
                montantAssurance: true,
                montantPatient: true,
                statut: true,
                codeValideParPatient: true,
                dateValidationPatient: true,
                dateReglement: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        actes: {
          where: { deletedAt: null },
          orderBy: { datePrescription: 'asc' },
          include: {
            lignesFacturation: {
              select: { id: true, statut: true, montantReclame: true, datePaiement: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        // Historique du dossier (v3 §5 complément) : visible par tout rôle
        // ayant déjà accès au dossier (ce même `chargerDossier`) — écriture
        // réservée à `ajouterNote` (ASSUREUR_EXPLOITATION/MEDECIN_CONSEIL).
        notes: {
          orderBy: { createdAt: 'desc' },
          include: { auteur: { select: { role: true } } },
        },
      },
    });
    if (!dossier) {
      throw new NotFoundException('Dossier de soins introuvable.');
    }
    return dossier;
  }

  /**
   * Note libre sur un dossier (ou un acte précis, `dto.acteDossierId`) —
   * réservée à ASSUREUR_EXPLOITATION(_CONJOINTE, par héritage de rôle)/
   * ASSUREUR_MEDECIN_CONSEIL. Visible ensuite dans `chargerDossier` par tout
   * rôle qui a déjà accès en lecture au dossier (`modeLectureDossiers`).
   */
  async ajouterNote(user: AuthenticatedUser, dossierId: string, dto: AjouterNoteDto) {
    const ctx = await this.contexteAppelant(user);
    if (
      !ctx.roleChain.some((r) =>
        (ROLES_ECRITURE_NOTE_DOSSIER as readonly string[]).includes(r),
      )
    ) {
      throw new ForbiddenException(
        "L'ajout d'une note est réservé à ASSUREUR_EXPLOITATION ou ASSUREUR_MEDECIN_CONSEIL.",
      );
    }

    const dossier = await this.chargerDossierBrut(ctx.organisationId, dossierId);

    if (dto.acteDossierId) {
      const acte = await this.prisma.acteDossier.findFirst({
        where: { id: dto.acteDossierId, dossierSoinsId: dossier.id, deletedAt: null },
        select: { id: true },
      });
      if (!acte) {
        throw new NotFoundException("Cet acte n'appartient pas à ce dossier de soins.");
      }
    }

    const note = await this.prisma.$transaction(async (tx) => {
      const cree = await tx.noteDossier.create({
        data: {
          organisationId: ctx.organisationId,
          dossierSoinsId: dossier.id,
          acteDossierId: dto.acteDossierId ?? null,
          auteurId: ctx.userId,
          contenu: dto.contenu,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'AJOUT_NOTE_DOSSIER',
        cree.id,
        { dossierSoinsId: dossier.id, acteDossierId: dto.acteDossierId ?? null },
        'notes_dossier',
      );
      return cree;
    });

    return note;
  }

  /** Code de ticket cryptographiquement sûr (`crypto.randomInt`), unique. */
  private async genererCodeTicketUnique(): Promise<string> {
    for (let tentative = 0; tentative < 6; tentative += 1) {
      let code = '';
      for (let i = 0; i < 8; i += 1) {
        code += ALPHABET_TICKET[randomInt(ALPHABET_TICKET.length)];
      }
      const existe = await this.prisma.ticketSoins.findUnique({
        where: { code },
      });
      if (!existe) {
        return code;
      }
    }
    throw new ConflictException(
      'Impossible de générer un code de ticket unique — réessayez.',
    );
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
