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
  DefinirPrixStockDto,
  LigneChoisieDto,
  ListerDispensationsQueryDto,
  SubstituerMedicamentDto,
  ValiderCodeDispensationDto,
} from './dto/pharmacy.dto';
import {
  ALPHABET_CODE,
  ContexteAppelant,
  LONGUEUR_CODE,
  ROLES_ADHERENT,
  ROLES_PHARMACIE,
  ROLE_PHARMACIEN_SEUL,
  STATUTS_DISPENSATION_MODIFIABLE,
} from './pharmacy.types';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * PharmacyService — révision majeure du flux pharmacie (clarification
 * métier) : verrou PAR LIGNE de médicament, pas par ordonnance entière
 * (PROMPT 19). Une même ordonnance peut être servie par plusieurs pharmacies
 * différentes, une ligne donnée jamais deux fois.
 *
 * `rechercherPrescriptionsParCarte` identifie le patient par son numéro de
 * carte — PAS un code secret (toute pharmacie du réseau peut consulter les
 * ordonnances actives d'un porteur de carte, comme en pratique). L'anti-fraude
 * porte désormais sur le PAIEMENT (code de confirmation envoyé au patient),
 * pas sur la lecture du contenu.
 */
@Injectable()
export class PharmacyService {
  private readonly logger = new Logger(PharmacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  // --- Recherche par carte -----------------------------------------

  async rechercherPrescriptionsParCarte(user: AuthenticatedUser, numeroCarte: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);

    const carte = numeroCarte.trim();
    const adherent = await this.prisma.adherent.findFirst({
      where: { numeroCarte: carte, organisationId: ctx.organisationId, deletedAt: null },
      select: { id: true, nom: true, prenom: true, numeroCarte: true, statut: true },
    });
    const beneficiaire = adherent
      ? null
      : await this.prisma.beneficiaire.findFirst({
          where: {
            numeroCarte: carte,
            deletedAt: null,
            adherent: { organisationId: ctx.organisationId, deletedAt: null },
          },
          select: {
            id: true,
            nom: true,
            prenom: true,
            numeroCarte: true,
            statut: true,
            adherentId: true,
          },
        });

    if (!adherent && !beneficiaire) {
      throw new NotFoundException('Aucun adhérent ou bénéficiaire pour ce numéro de carte.');
    }

    const dossiersWhere = adherent
      ? { adherentId: adherent.id }
      : { beneficiaireId: beneficiaire!.id };

    const ordonnances = await this.prisma.ordonnance.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        statut: { in: ['ACTIVE', 'PARTIELLEMENT_DELIVREE'] },
        dossier: dossiersWhere,
      },
      include: {
        dossier: { select: { numeroTraitement: true } },
        lignesOrdonnance: {
          select: {
            id: true,
            denominationMedicament: true,
            dosage: true,
            posologie: true,
            duree: true,
            quantitePrescrite: true,
            statut: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { datePrescription: 'desc' },
    });

    return {
      patient: adherent
        ? { qualite: 'TITULAIRE' as const, nom: adherent.nom, prenom: adherent.prenom, numeroCarte: adherent.numeroCarte, statut: adherent.statut }
        : { qualite: 'BENEFICIAIRE' as const, nom: beneficiaire!.nom, prenom: beneficiaire!.prenom, numeroCarte: beneficiaire!.numeroCarte, statut: beneficiaire!.statut },
      ordonnances: ordonnances.map((o) => ({
        id: o.id,
        numeroTraitement: o.dossier.numeroTraitement,
        statut: o.statut,
        datePrescription: o.datePrescription,
        dateValidite: o.dateValidite,
        lignes: o.lignesOrdonnance.map((l) => ({
          id: l.id,
          denominationMedicament: l.denominationMedicament,
          dosage: l.dosage,
          posologie: l.posologie,
          duree: l.duree,
          quantitePrescrite: l.quantitePrescrite,
          statut: l.statut,
        })),
      })),
    };
  }

  // --- Stock (lecture : les 3 rôles PHARMACIE ; écriture : pharmacien seul) -

  /**
   * Lecture ouverte aux 3 rôles PHARMACIE de la pharmacie (la caissière doit
   * pouvoir vérifier, au moment de la dispensation, si un médicament est en
   * stock et à quel prix — clarification métier). L'ÉCRITURE reste réservée
   * au seul pharmacien (`definirPrixStock`, inchangé).
   */
  async listerStock(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);
    return this.prisma.stockMedicamentPharmacie.findMany({
      where: { pharmacieId: ctx.pharmacieId! },
      orderBy: { denominationMedicament: 'asc' },
    });
  }

  async definirPrixStock(user: AuthenticatedUser, dto: DefinirPrixStockDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacien(ctx);

    return this.prisma.stockMedicamentPharmacie.upsert({
      where: {
        pharmacieId_denominationMedicament: {
          pharmacieId: ctx.pharmacieId!,
          denominationMedicament: dto.denominationMedicament,
        },
      },
      create: {
        pharmacieId: ctx.pharmacieId!,
        denominationMedicament: dto.denominationMedicament,
        prixPharmacie: dto.prixPharmacie === undefined ? null : new Decimal(dto.prixPharmacie).toFixed(2),
        disponible: dto.disponible ?? true,
      },
      update: {
        ...(dto.prixPharmacie !== undefined ? { prixPharmacie: new Decimal(dto.prixPharmacie).toFixed(2) } : {}),
        ...(dto.disponible !== undefined ? { disponible: dto.disponible } : {}),
        dateMaj: new Date(),
      },
    });
  }

  // --- Préparation d'une dispensation (par ligne) -------------------

  /**
   * Choisit des lignes DISPONIBLES d'une ordonnance, calcule le montant depuis
   * le stock de LA pharmacie appelante (`ctx.pharmacieId`, jamais un paramètre
   * client), génère le code de confirmation — envoyé à l'ADHÉRENT uniquement
   * (jamais à la pharmacie, même principe que les 4 codes déjà construits).
   * Les lignes ne passent PAS à SERVIE ici : seul le paiement confirmé
   * verrouille (`confirmerPaiementDispensation`).
   */
  async preparerDispensation(
    user: AuthenticatedUser,
    ordonnanceId: string,
    lignesChoisies: LigneChoisieDto[],
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);
    const pharmacieId = ctx.pharmacieId!;

    const ordonnance = await this.prisma.ordonnance.findFirst({
      where: { id: ordonnanceId, organisationId: ctx.organisationId, deletedAt: null },
      include: { dossier: { select: { adherentId: true, beneficiaireId: true } } },
    });
    if (!ordonnance) {
      throw new NotFoundException('Ordonnance introuvable.');
    }
    if (['EXPIREE', 'ANNULEE'].includes(ordonnance.statut)) {
      throw new ConflictException(`Ordonnance ${ordonnance.statut.toLowerCase()} — dispensation impossible.`);
    }

    const lignes = await this.prisma.ligneOrdonnance.findMany({
      where: { id: { in: lignesChoisies.map((l) => l.ligneOrdonnanceId) }, ordonnanceId },
    });
    if (lignes.length !== lignesChoisies.length) {
      throw new BadRequestException("Une ou plusieurs lignes n'appartiennent pas à cette ordonnance.");
    }
    const dejaServies = lignes.filter((l) => l.statut !== 'DISPONIBLE');
    if (dejaServies.length > 0) {
      throw new ConflictException(
        `Ligne(s) déjà servie(s), non disponible(s) : ${dejaServies.map((l) => l.denominationMedicament).join(', ')}.`,
      );
    }

    // Montant depuis le stock DE CETTE PHARMACIE (jamais un prix fourni par le client).
    const stock = await this.prisma.stockMedicamentPharmacie.findMany({
      where: {
        pharmacieId,
        denominationMedicament: { in: lignes.map((l) => l.denominationMedicament) },
      },
    });
    const parDenomination = new Map(stock.map((s) => [s.denominationMedicament, s]));

    const detail: { ligne: (typeof lignes)[number]; quantite: number; prixUnitaire: Decimal; montantLigne: Decimal }[] = [];
    for (const choix of lignesChoisies) {
      const ligne = lignes.find((l) => l.id === choix.ligneOrdonnanceId)!;
      const s = parDenomination.get(ligne.denominationMedicament);
      if (!s || s.prixPharmacie === null || !s.disponible) {
        throw new ConflictException(
          `Prix non défini ou médicament indisponible dans votre pharmacie : ${ligne.denominationMedicament}. Le pharmacien doit d'abord le renseigner.`,
        );
      }
      const quantite = choix.quantite ?? ligne.quantitePrescrite;
      const prixUnitaire = new Decimal(s.prixPharmacie.toString());
      detail.push({ ligne, quantite, prixUnitaire, montantLigne: prixUnitaire.mul(quantite) });
    }
    const montantTotal = detail.reduce((acc, d) => acc.add(d.montantLigne), new Decimal(0));

    const code = await this.genererCodeUnique();

    const dispensation = await this.prisma.$transaction(async (tx) => {
      const d = await tx.dispensationPharmacie.create({
        data: {
          ordonnanceId,
          pharmacieId,
          caissiereId: ctx.userId,
          montantTotal: montantTotal.toFixed(2),
          statut: 'EN_PREPARATION',
        },
      });
      await this.audit(tx, ctx.userId, 'PREPARATION_DISPENSATION', 'dispensations_pharmacie', d.id, {
        ordonnanceId,
        lignes: detail.map((x) => x.ligne.denominationMedicament),
      });

      await tx.ligneDispensation.createMany({
        data: detail.map((x) => ({
          dispensationId: d.id,
          ligneOrdonnanceId: x.ligne.id,
          prixUnitaire: x.prixUnitaire.toFixed(2),
          quantite: x.quantite,
          montantLigne: x.montantLigne.toFixed(2),
        })),
      });

      const mis = await tx.dispensationPharmacie.update({
        where: { id: d.id },
        data: { statut: 'EN_ATTENTE_VALIDATION_PATIENT', codeConfirmation: code },
      });
      await this.audit(tx, ctx.userId, 'GENERATION_CODE_DISPENSATION', 'dispensations_pharmacie', d.id, {
        montantTotal: montantTotal.toFixed(2),
      });
      return mis;
    });

    // Réponse à LA PHARMACIE — jamais le code (envoyé à l'adhérent uniquement).
    return {
      dispensationId: dispensation.id,
      statut: dispensation.statut,
      montantTotal: dispensation.montantTotal.toFixed(2),
      message: "Dispensation préparée. Le code de confirmation a été transmis au patient pour validation.",
    };
  }

  /**
   * Détail d'une dispensation, côté PHARMACIE — scopé à SA pharmacie
   * uniquement (jamais celle d'une autre, même schéma que
   * `confirmerPaiementDispensation`). Permet à l'écran caissière/pharmacien
   * de suivre le statut (attente de validation patient → payable) et de
   * lister les lignes pour proposer une substitution. Le code de confirmation
   * n'est JAMAIS renvoyé ici (il ne part qu'au patient).
   */
  async obtenirDispensation(user: AuthenticatedUser, dispensationId: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);

    const dispensation = await this.prisma.dispensationPharmacie.findFirst({
      where: { id: dispensationId, pharmacieId: ctx.pharmacieId! },
      include: {
        lignes: { include: { ligneOrdonnance: { select: { denominationMedicament: true } } } },
      },
    });
    if (!dispensation) {
      throw new NotFoundException('Dispensation introuvable.');
    }

    return {
      id: dispensation.id,
      statut: dispensation.statut,
      montantTotal: dispensation.montantTotal.toFixed(2),
      datePreparation: dispensation.datePreparation,
      dateValidationPatient: dispensation.dateValidationPatient,
      datePaiement: dispensation.datePaiement,
      lignes: dispensation.lignes.map((l) => ({
        id: l.id,
        ligneOrdonnanceId: l.ligneOrdonnanceId,
        denominationMedicament: l.ligneOrdonnance.denominationMedicament,
        medicamentSubstitue: l.medicamentSubstitue,
        motifSubstitution: l.motifSubstitution,
        quantite: l.quantite,
        prixUnitaire: l.prixUnitaire.toFixed(2),
        montantLigne: l.montantLigne.toFixed(2),
      })),
    };
  }

  /**
   * Liste des dispensations de SA pharmacie — corrige l'incohérence relevée
   * à l'audit : `pharmacien`/`comptable` lisaient encore l'ancien mécanisme
   * `codes_ordonnance` (PROMPT 19), qui ne reçoit plus d'écriture depuis que
   * la dispensation réelle passe par ce module. Filtre optionnel par statut
   * (le comptable ne veut que PAYEE). Le code de confirmation n'est JAMAIS
   * renvoyé ici (il ne part qu'au patient).
   */
  async listerDispensationsPharmacie(user: AuthenticatedUser, dto: ListerDispensationsQueryDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);

    const dispensations = await this.prisma.dispensationPharmacie.findMany({
      where: {
        pharmacieId: ctx.pharmacieId!,
        ...(dto.statut ? { statut: dto.statut } : {}),
      },
      include: {
        ordonnance: {
          include: {
            dossier: {
              select: {
                adherent: { select: { nom: true, prenom: true, numeroCarte: true } },
                beneficiaire: { select: { nom: true, prenom: true, numeroCarte: true } },
              },
            },
          },
        },
        lignes: { include: { ligneOrdonnance: { select: { denominationMedicament: true } } } },
      },
      orderBy: { datePreparation: 'desc' },
      take: 100,
    });

    return dispensations.map((d) => {
      const patient = d.ordonnance.dossier.adherent ?? d.ordonnance.dossier.beneficiaire;
      return {
        id: d.id,
        statut: d.statut,
        montantTotal: d.montantTotal.toFixed(2),
        datePreparation: d.datePreparation,
        dateValidationPatient: d.dateValidationPatient,
        datePaiement: d.datePaiement,
        patient: patient
          ? { nom: patient.nom, prenom: patient.prenom, numeroCarte: patient.numeroCarte }
          : null,
        lignes: d.lignes.map((l) => ({
          denominationMedicament: l.medicamentSubstitue ?? l.ligneOrdonnance.denominationMedicament,
          quantite: l.quantite,
          montantLigne: l.montantLigne.toFixed(2),
        })),
      };
    });
  }

  // --- Côté ADHÉRENT : ses dispensations en attente (avec le code) --

  async listerMesDispensations(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.adherentId) {
      return [];
    }
    const dispensations = await this.prisma.dispensationPharmacie.findMany({
      where: {
        ordonnance: {
          dossier: {
            OR: [
              { adherentId: ctx.adherentId },
              { beneficiaire: { adherentId: ctx.adherentId } },
            ],
          },
        },
      },
      include: {
        pharmacie: { select: { nom: true } },
        lignes: { include: { ligneOrdonnance: { select: { denominationMedicament: true } } } },
      },
      orderBy: { datePreparation: 'desc' },
      take: 50,
    });
    return dispensations.map((d) => ({
      id: d.id,
      pharmacie: d.pharmacie.nom,
      statut: d.statut,
      montantTotal: d.montantTotal.toFixed(2),
      code: d.statut === 'EN_ATTENTE_VALIDATION_PATIENT' ? d.codeConfirmation : undefined,
      medicaments: d.lignes.map((l) => l.ligneOrdonnance.denominationMedicament),
      datePreparation: d.datePreparation,
    }));
  }

  /** Validation du code par l'ADHÉRENT — passe à VALIDEE, PAS encore PAYEE. */
  async validerCodeDispensation(user: AuthenticatedUser, dto: ValiderCodeDispensationDto) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.some((r) => (ROLES_ADHERENT as readonly string[]).includes(r))) {
      throw new ForbiddenException('Seul un adhérent peut valider un code de dispensation.');
    }
    if (!ctx.adherentId) {
      throw new ForbiddenException("Votre compte n'est rattaché à aucun adhérent.");
    }

    const dispensation = await this.prisma.dispensationPharmacie.findUnique({
      where: { codeConfirmation: dto.code.toUpperCase() },
      include: { ordonnance: { include: { dossier: { include: { beneficiaire: true } } } } },
    });
    if (!dispensation) {
      throw new NotFoundException('Code de dispensation invalide.');
    }
    const dossier = dispensation.ordonnance.dossier;
    const estLePatient =
      dossier.adherentId === ctx.adherentId ||
      (dossier.beneficiaire && dossier.beneficiaire.adherentId === ctx.adherentId);
    if (!estLePatient) {
      throw new ForbiddenException('Cette dispensation ne vous concerne pas.');
    }
    if (dispensation.statut !== 'EN_ATTENTE_VALIDATION_PATIENT') {
      throw new ConflictException(
        `Ce code ne peut plus être validé (statut actuel : ${dispensation.statut}).`,
      );
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const d = await tx.dispensationPharmacie.update({
        where: { id: dispensation.id },
        data: { statut: 'VALIDEE', dateValidationPatient: new Date() },
      });
      await this.audit(tx, ctx.userId, 'VALIDATION_CODE_DISPENSATION', 'dispensations_pharmacie', d.id, null);
      return d;
    });

    return { dispensationId: maj.id, statut: maj.statut };
  }

  /**
   * Confirmation du paiement — réservée à la pharmacie propriétaire de la
   * dispensation.
   *
   * GARDE BLOQUANTE EXPLICITE : refuse absolument si le statut n'est pas
   * VALIDEE — même principe que `confirmerPaiement` (factures établissement,
   * v8 §5). Doublée par le trigger `verifier_dispensation_payable()`.
   * Verrouille chaque ligne concernée (compare-and-swap : DISPONIBLE ->
   * SERVIE) — si une ligne a été prise entre-temps par une autre pharmacie,
   * la transaction entière échoue plutôt que de facturer une ligne déjà
   * servie ailleurs.
   */
  async confirmerPaiementDispensation(user: AuthenticatedUser, dispensationId: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);

    const dispensation = await this.prisma.dispensationPharmacie.findFirst({
      where: { id: dispensationId, pharmacieId: ctx.pharmacieId! },
      include: { lignes: true },
    });
    if (!dispensation) {
      throw new NotFoundException('Dispensation introuvable.');
    }

    // >>> GARDE ANTI-FRAUDE — NE JAMAIS RETIRER <<<
    if (dispensation.statut !== 'VALIDEE') {
      throw new ForbiddenException(
        dispensation.statut === 'PAYEE'
          ? 'Cette dispensation a déjà été payée.'
          : "Règlement impossible : le code de confirmation n'a pas encore été validé par le patient.",
      );
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      for (const ligne of dispensation.lignes) {
        const { count } = await tx.ligneOrdonnance.updateMany({
          where: { id: ligne.ligneOrdonnanceId, statut: 'DISPONIBLE' },
          data: {
            statut: 'SERVIE',
            pharmacieServanteId: ctx.pharmacieId!,
            quantiteServie: ligne.quantite,
          },
        });
        if (count === 0) {
          throw new ConflictException(
            "Une des lignes de cette dispensation a déjà été servie par une autre pharmacie entre-temps — paiement annulé, réessayez.",
          );
        }
      }
      const d = await tx.dispensationPharmacie.update({
        where: { id: dispensationId },
        data: { statut: 'PAYEE', datePaiement: new Date() },
      });
      await this.audit(tx, ctx.userId, 'CONFIRMATION_PAIEMENT_DISPENSATION', 'dispensations_pharmacie', d.id, {
        montantTotal: d.montantTotal.toFixed(2),
      });
      return d;
    });

    return {
      dispensationId: maj.id,
      statut: maj.statut,
      montantTotal: maj.montantTotal.toFixed(2),
      datePaiement: maj.datePaiement,
    };
  }

  // --- Substitution de médicament (PHARMACIE_PHARMACIEN exclusivement) --

  /**
   * Remplace/ajuste le médicament d'une ligne de dispensation — réservé au
   * PHARMACIEN (jamais la caissière ni le comptable, clarification métier :
   * "concernant la modification ou la substitution d'un médicament le
   * pharmacien doit valider"). Ne s'applique QUE tant que le paiement n'a pas
   * été confirmé (EN_PREPARATION ou EN_ATTENTE_VALIDATION_PATIENT) — une fois
   * VALIDEE par le patient (il a vu le total correspondant) ou PAYEE, le
   * contenu ne peut plus changer en silence.
   */
  async substituerMedicament(
    user: AuthenticatedUser,
    ligneDispensationId: string,
    dto: SubstituerMedicamentDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacien(ctx);

    const ligne = await this.prisma.ligneDispensation.findFirst({
      where: { id: ligneDispensationId, dispensation: { pharmacieId: ctx.pharmacieId! } },
      include: { dispensation: true, ligneOrdonnance: true },
    });
    if (!ligne) {
      throw new NotFoundException('Ligne de dispensation introuvable.');
    }
    if (!(STATUTS_DISPENSATION_MODIFIABLE as readonly string[]).includes(ligne.dispensation.statut)) {
      throw new ConflictException(
        `Substitution impossible : cette dispensation est déjà ${ligne.dispensation.statut} — le paiement ne peut plus être modifié en silence.`,
      );
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const l = await tx.ligneDispensation.update({
        where: { id: ligneDispensationId },
        data: {
          medicamentSubstitue: dto.nouveauMedicament,
          motifSubstitution: dto.motif,
          substitueParId: ctx.userId,
          dateSubstitution: new Date(),
        },
      });
      await this.audit(tx, ctx.userId, 'SUBSTITUTION_MEDICAMENT', 'lignes_dispensation', l.id, {
        dispensationId: ligne.dispensationId,
        medicamentOriginal: ligne.ligneOrdonnance.denominationMedicament,
        nouveauMedicament: dto.nouveauMedicament,
        motif: dto.motif,
      });
      return l;
    });

    return {
      ligneDispensationId: maj.id,
      medicamentOriginal: ligne.ligneOrdonnance.denominationMedicament,
      medicamentSubstitue: maj.medicamentSubstitue,
      motif: maj.motifSubstitution,
      dateSubstitution: maj.dateSubstitution,
    };
  }

  // --- Helpers -------------------------------------------------------

  private async contexteAppelant(user: AuthenticatedUser): Promise<ContexteAppelant> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    }
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      role: profil.role,
      roleChain: permissions?.roleChain ?? [],
      pharmacieId: profil.pharmacieId,
      adherentId: profil.adherentId,
    };
  }

  private assertPharmacie(ctx: ContexteAppelant): void {
    const estPharmacie = ctx.roleChain.some((r) => (ROLES_PHARMACIE as readonly string[]).includes(r));
    if (!estPharmacie || !ctx.pharmacieId) {
      throw new ForbiddenException("Réservé au personnel d'une pharmacie du réseau.");
    }
  }

  private assertPharmacien(ctx: ContexteAppelant): void {
    if (!ctx.roleChain.includes(ROLE_PHARMACIEN_SEUL) || !ctx.pharmacieId) {
      throw new ForbiddenException('Réservé au pharmacien titulaire de la pharmacie.');
    }
  }

  private async genererCodeUnique(): Promise<string> {
    for (let tentative = 0; tentative < 6; tentative += 1) {
      let candidat = '';
      for (let i = 0; i < LONGUEUR_CODE; i += 1) {
        candidat += ALPHABET_CODE[randomInt(ALPHABET_CODE.length)];
      }
      const existe = await this.prisma.dispensationPharmacie.findUnique({
        where: { codeConfirmation: candidat },
      });
      if (!existe) {
        return candidat;
      }
    }
    throw new ConflictException("Impossible de générer un code unique — réessayez.");
  }

  private async audit(
    db: Db,
    userId: string,
    action: string,
    table: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
  ): Promise<void> {
    try {
      await db.$executeRaw`
        SELECT log_audit(
          ${action}::text,
          ${table}::text,
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
