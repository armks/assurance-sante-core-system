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
import { ClaimsService } from '../claims/claims.service';
import {
  ROLE_PHARMACIEN_CONSEIL,
  STATUTS_CONTESTATION_EN_LITIGE,
} from '../contestation/contestation.types';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  DefinirPrixStockDto,
  LigneChoisieDto,
  ListerDispensationsQueryDto,
  SoumettreFactureMensuelleDto,
  SubstituerMedicamentDto,
  ValiderCodeDispensationDto,
  ValiderFactureMensuelleDto,
} from './dto/pharmacy.dto';
import {
  ALPHABET_CODE,
  CATEGORIE_ACTE_PHARMACIE,
  ContexteAppelant,
  LONGUEUR_CODE,
  ROLES_ADHERENT,
  ROLES_FACTURATION_MENSUELLE,
  ROLES_PHARMACIE,
  ROLE_COMPTABLE_FACTURE_MENSUELLE,
  ROLE_PHARMACIEN_SEUL,
  STATUTS_DISPENSATION_MODIFIABLE,
  TAUX_COUVERTURE_DEFAUT,
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
    private readonly claims: ClaimsService,
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
      include: {
        dossier: {
          select: {
            adherentId: true,
            beneficiaireId: true,
            police: { select: { produitId: true } },
          },
        },
      },
    });
    if (!ordonnance) {
      throw new NotFoundException('Ordonnance introuvable.');
    }
    if (['EXPIREE', 'ANNULEE'].includes(ordonnance.statut)) {
      throw new ConflictException(`Ordonnance ${ordonnance.statut.toLowerCase()} — dispensation impossible.`);
    }

    // Part assurance / part patient — même logique que
    // PreauthorizationService.simulerMontantActe (garanties.tauxCouverture,
    // catégorie PHARMACIE, plafond par acte éventuel). Une seule garantie
    // pour toute la dispensation : toutes les lignes viennent de la même
    // ordonnance -> même dossier -> même police -> même produit.
    const garantiePharmacie = await this.prisma.garantie.findFirst({
      where: {
        produitId: ordonnance.dossier.police.produitId,
        categorieActe: CATEGORIE_ACTE_PHARMACIE,
        deletedAt: null,
      },
    });

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

    const taux = new Decimal(
      garantiePharmacie?.tauxCouverture?.toString() ?? String(TAUX_COUVERTURE_DEFAUT),
    );
    const plafondParActe = garantiePharmacie?.plafondParActe
      ? new Decimal(garantiePharmacie.plafondParActe.toString())
      : null;

    const detail: {
      ligne: (typeof lignes)[number];
      quantite: number;
      prixUnitaire: Decimal;
      montantLigne: Decimal;
      montantAssurance: Decimal;
      montantPatient: Decimal;
    }[] = [];
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
      const montantLigne = prixUnitaire.mul(quantite);
      let montantAssurance = montantLigne.mul(taux).div(100).toDecimalPlaces(2);
      if (plafondParActe && montantAssurance.gt(plafondParActe)) {
        montantAssurance = plafondParActe;
      }
      const montantPatient = montantLigne.sub(montantAssurance);
      detail.push({ ligne, quantite, prixUnitaire, montantLigne, montantAssurance, montantPatient });
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
          montantAssurance: x.montantAssurance.toFixed(2),
          montantPatient: x.montantPatient.toFixed(2),
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

    const montantAssuranceTotal = detail.reduce((acc, d) => acc.add(d.montantAssurance), new Decimal(0));
    const montantPatientTotal = detail.reduce((acc, d) => acc.add(d.montantPatient), new Decimal(0));

    // Réponse à LA PHARMACIE — jamais le code (envoyé à l'adhérent uniquement).
    return {
      dispensationId: dispensation.id,
      statut: dispensation.statut,
      montantTotal: dispensation.montantTotal.toFixed(2),
      montantAssurance: montantAssuranceTotal.toFixed(2),
      montantPatient: montantPatientTotal.toFixed(2),
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
        reclamations: { select: { id: true, statut: true }, take: 1 },
      },
    });
    if (!dispensation) {
      throw new NotFoundException('Dispensation introuvable.');
    }

    const enLitige = await this.chargerLignesEnLitige(
      dispensation.lignes.map((l) => l.ligneOrdonnanceId),
    );
    const montantAssurance = dispensation.lignes.reduce(
      (acc, l) =>
        enLitige.has(l.ligneOrdonnanceId) ? acc : acc.add(new Decimal(l.montantAssurance.toString())),
      new Decimal(0),
    );
    const montantPatient = dispensation.lignes.reduce(
      (acc, l) =>
        enLitige.has(l.ligneOrdonnanceId) ? acc : acc.add(new Decimal(l.montantPatient.toString())),
      new Decimal(0),
    );

    return {
      id: dispensation.id,
      statut: dispensation.statut,
      montantTotal: dispensation.montantTotal.toFixed(2),
      montantAssurance: montantAssurance.toFixed(2),
      montantPatient: montantPatient.toFixed(2),
      datePreparation: dispensation.datePreparation,
      dateValidationPatient: dispensation.dateValidationPatient,
      datePaiement: dispensation.datePaiement,
      reclamation: dispensation.reclamations[0] ?? null,
      lignes: dispensation.lignes.map((l) => ({
        id: l.id,
        ligneOrdonnanceId: l.ligneOrdonnanceId,
        denominationMedicament: l.ligneOrdonnance.denominationMedicament,
        medicamentSubstitue: l.medicamentSubstitue,
        motifSubstitution: l.motifSubstitution,
        quantite: l.quantite,
        prixUnitaire: l.prixUnitaire.toFixed(2),
        montantLigne: l.montantLigne.toFixed(2),
        enLitige: enLitige.has(l.ligneOrdonnanceId),
        montantAssurance: enLitige.has(l.ligneOrdonnanceId) ? null : l.montantAssurance.toFixed(2),
        montantPatient: enLitige.has(l.ligneOrdonnanceId) ? null : l.montantPatient.toFixed(2),
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

    const enLitige = await this.chargerLignesEnLitige(
      dispensations.flatMap((d) => d.lignes.map((l) => l.ligneOrdonnanceId)),
    );

    return dispensations.map((d) => {
      const patient = d.ordonnance.dossier.adherent ?? d.ordonnance.dossier.beneficiaire;
      const montantAssurance = d.lignes.reduce(
        (acc, l) =>
          enLitige.has(l.ligneOrdonnanceId) ? acc : acc.add(new Decimal(l.montantAssurance.toString())),
        new Decimal(0),
      );
      const montantPatient = d.lignes.reduce(
        (acc, l) =>
          enLitige.has(l.ligneOrdonnanceId) ? acc : acc.add(new Decimal(l.montantPatient.toString())),
        new Decimal(0),
      );
      return {
        id: d.id,
        statut: d.statut,
        montantTotal: d.montantTotal.toFixed(2),
        montantAssurance: montantAssurance.toFixed(2),
        montantPatient: montantPatient.toFixed(2),
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
          enLitige: enLitige.has(l.ligneOrdonnanceId),
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
    return dispensations.map((d) => {
      const montantPatient = d.lignes.reduce(
        (acc, l) => acc.add(new Decimal(l.montantPatient.toString())),
        new Decimal(0),
      );
      return {
        id: d.id,
        pharmacie: d.pharmacie.nom,
        statut: d.statut,
        montantTotal: d.montantTotal.toFixed(2),
        montantPatient: montantPatient.toFixed(2),
        code: d.statut === 'EN_ATTENTE_VALIDATION_PATIENT' ? d.codeConfirmation : undefined,
        medicaments: d.lignes.map((l) => l.ligneOrdonnance.denominationMedicament),
        datePreparation: d.datePreparation,
      };
    });
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
   *
   * Le patient ne règle QUE `montantPatient` (jamais le total) : dès le
   * paiement enregistré, une réclamation est soumise au microservice
   * d'adjudication pour `montantAssurance` — « une dispensation payée = un
   * remboursement réclamé », jamais un flux séparé sans lien avec
   * l'adjudication. Le paiement lui-même reste acquis même si l'appel
   * d'adjudication échoue (le patient a déjà réglé) : l'erreur remonte
   * explicitement (502/503, même contrat que `ClaimsService.soumettre`) pour
   * qu'une nouvelle tentative de soumission soit possible — la réclamation
   * reste idempotente sur `dispensationId`.
   */
  async confirmerPaiementDispensation(user: AuthenticatedUser, dispensationId: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);

    const dispensation = await this.prisma.dispensationPharmacie.findFirst({
      where: { id: dispensationId, pharmacieId: ctx.pharmacieId! },
      include: {
        lignes: true,
        ordonnance: {
          include: {
            dossier: {
              select: {
                id: true,
                adherentId: true,
                beneficiaireId: true,
                policeId: true,
                police: { select: { produitId: true } },
              },
            },
          },
        },
      },
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

    const montantAssurance = dispensation.lignes.reduce(
      (acc, l) => acc.add(new Decimal(l.montantAssurance.toString())),
      new Decimal(0),
    );
    const montantPatient = dispensation.lignes.reduce(
      (acc, l) => acc.add(new Decimal(l.montantPatient.toString())),
      new Decimal(0),
    );

    const dossier = dispensation.ordonnance.dossier;
    const garantiePharmacie = await this.prisma.garantie.findFirst({
      where: {
        produitId: dossier.police.produitId,
        categorieActe: CATEGORIE_ACTE_PHARMACIE,
        deletedAt: null,
      },
    });

    let reclamation: { id: string; statut: string } | null = null;
    if (garantiePharmacie && montantAssurance.gt(0)) {
      const resultat = await this.claims.soumettreDepuisDispensation(
        { userId: ctx.userId, organisationId: ctx.organisationId },
        {
          dispensationId: maj.id,
          dossierSoinsId: dossier.id,
          adherentId: dossier.adherentId,
          beneficiaireId: dossier.beneficiaireId,
          policeId: dossier.policeId,
          garantieId: garantiePharmacie.id,
          montant: montantAssurance.toFixed(2),
        },
      );
      reclamation = {
        id: resultat.reclamation.id,
        statut: resultat.reclamation.statut,
      };
    }

    return {
      dispensationId: maj.id,
      statut: maj.statut,
      montantTotal: maj.montantTotal.toFixed(2),
      montantAssurance: montantAssurance.toFixed(2),
      montantPatient: montantPatient.toFixed(2),
      datePaiement: maj.datePaiement,
      reclamation,
    };
  }

  // --- Substitution de médicament (PHARMACIE_PHARMACIEN + ASSUREUR_PHARMACIEN_CONSEIL) --

  /**
   * Remplace/ajuste le médicament d'une ligne de dispensation — réservé au
   * PHARMACIEN de la pharmacie concernée (jamais la caissière ni le
   * comptable, clarification métier : "concernant la modification ou la
   * substitution d'un médicament le pharmacien doit valider") **ou** à
   * ASSUREUR_PHARMACIEN_CONSEIL (capacité ADDITIVE, organisation entière —
   * ex. correction a posteriori lors d'une revue de contestation). L'audit
   * distingue les deux acteurs (`SUBSTITUTION_PHARMACIEN` vs
   * `SUBSTITUTION_PHARMACIEN_CONSEIL`). Ne s'applique QUE tant que le
   * paiement n'a pas été confirmé (EN_PREPARATION ou
   * EN_ATTENTE_VALIDATION_PATIENT) — une fois VALIDEE par le patient (il a vu
   * le total correspondant) ou PAYEE, le contenu ne peut plus changer en
   * silence, quel que soit l'acteur.
   */
  async substituerMedicament(
    user: AuthenticatedUser,
    ligneDispensationId: string,
    dto: SubstituerMedicamentDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    const acteur = this.assertPeutSubstituer(ctx);

    const ligne = await this.prisma.ligneDispensation.findFirst({
      where: {
        id: ligneDispensationId,
        dispensation:
          acteur === 'PHARMACIEN_CONSEIL'
            ? { pharmacie: { organisationId: ctx.organisationId } }
            : { pharmacieId: ctx.pharmacieId! },
      },
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

    const action = acteur === 'PHARMACIEN_CONSEIL' ? 'SUBSTITUTION_PHARMACIEN_CONSEIL' : 'SUBSTITUTION_PHARMACIEN';
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
      await this.audit(tx, ctx.userId, action, 'lignes_dispensation', l.id, {
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

  // =====================================================================
  //  Consolidation mensuelle des factures pharmacie — circuit à 3 niveaux :
  //  PHARMACIE soumet → ASSUREUR_PHARMACIEN_CONSEIL valide (double
  //  vérification anti-litige) → ASSUREUR_COMPTABLE programme puis marque
  //  payée. `montantTotal` = somme des `montantAssurance` (ce que l'assureur
  //  doit à la pharmacie — le patient a déjà réglé `montantPatient` au
  //  comptoir), jamais `montantLigne` ni `montantPatient`.
  // =====================================================================

  /**
   * Bornes [début, fin[ du mois PRÉCÉDANT le mois en cours, en UTC (ce
   * système n'a pas de fuseau horaire à gérer — Abidjan = UTC toute l'année).
   */
  private bornesMoisPrecedent(maintenant: Date): { debut: Date; fin: Date } {
    const debut = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - 1, 1));
    const fin = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1));
    return { debut, fin };
  }

  /**
   * Soumet la consolidation du mois précédent — réservé à PHARMACIE_PHARMACIEN/
   * PHARMACIE_COMPTABLE (jamais la caissière), toujours pour SA pharmacie
   * (jamais un `pharmacieId` fourni par le client). `periode` doit être
   * exactement le 1er jour du mois précédent — pas de rattrapage de mois plus
   * anciens ni de mois en cours (déclenchable seulement à partir du 1er).
   * Agrège les `LigneDispensation` des dispensations PAYEE de la période,
   * jamais déjà réclamées par une facture antérieure
   * (`factureMensuelleId is null`), et EXCLUT toute ligne actuellement en
   * litige (`ContestationPrescription` OUVERT/JUSTIFICATION_RECUE/REJETEE) —
   * ces lignes ne sont pas stampées, elles restent donc éligibles à une
   * consolidation future une fois la contestation VALIDEE.
   */
  async soumettreFactureMensuelle(user: AuthenticatedUser, dto: SoumettreFactureMensuelleDto) {
    const ctx = await this.contexteAppelant(user);
    if (
      !ctx.roleChain.some((r) => (ROLES_FACTURATION_MENSUELLE as readonly string[]).includes(r)) ||
      !ctx.pharmacieId
    ) {
      throw new ForbiddenException(
        'Réservé au pharmacien ou au comptable de la pharmacie concernée.',
      );
    }

    const maintenant = new Date();
    const { debut, fin } = this.bornesMoisPrecedent(maintenant);
    const periodeDemandee = new Date(`${dto.periode}T00:00:00.000Z`);
    if (
      periodeDemandee.getUTCFullYear() !== debut.getUTCFullYear() ||
      periodeDemandee.getUTCMonth() !== debut.getUTCMonth()
    ) {
      throw new BadRequestException(
        `Seule la consolidation du mois précédent est possible actuellement (${debut.toISOString().slice(0, 7)}-01).`,
      );
    }

    const existante = await this.prisma.factureMensuellePharmacie.findFirst({
      where: { pharmacieId: ctx.pharmacieId, periode: debut },
    });
    if (existante && existante.statut !== 'EN_PREPARATION') {
      throw new ConflictException(
        `Une facture existe déjà pour cette période (statut : ${existante.statut}).`,
      );
    }

    // OR reportee_mois_suivant : une ligne exclue pour litige lors d'une
    // consolidation antérieure (soumission ou `decocherLigneContestee`) reste
    // candidate indéfiniment, quel que soit son `datePaiement` d'origine —
    // seul son statut de litige ACTUEL décide de sa réintégration.
    const toutesLignes = await this.prisma.ligneDispensation.findMany({
      where: {
        factureMensuelleId: null,
        dispensation: { pharmacieId: ctx.pharmacieId, statut: 'PAYEE' },
        OR: [
          { dispensation: { datePaiement: { gte: debut, lt: fin } } },
          { reporteeMoisSuivant: true },
        ],
      },
      select: { id: true, ligneOrdonnanceId: true, montantAssurance: true },
    });
    const enLitige = await this.chargerLignesEnLitige(toutesLignes.map((l) => l.ligneOrdonnanceId));
    const lignesFacturables = toutesLignes.filter((l) => !enLitige.has(l.ligneOrdonnanceId));
    const lignesEncoreEnLitige = toutesLignes.filter((l) => enLitige.has(l.ligneOrdonnanceId));
    const montantTotal = lignesFacturables.reduce(
      (acc, l) => acc.add(new Decimal(l.montantAssurance.toString())),
      new Decimal(0),
    );

    const facture = await this.prisma.$transaction(async (tx) => {
      const f = existante
        ? await tx.factureMensuellePharmacie.update({
            where: { id: existante.id },
            data: { montantTotal: montantTotal.toFixed(2) },
          })
        : await tx.factureMensuellePharmacie.create({
            data: {
              organisationId: ctx.organisationId,
              pharmacieId: ctx.pharmacieId!,
              periode: debut,
              montantTotal: montantTotal.toFixed(2),
            },
          });
      if (lignesFacturables.length > 0) {
        await tx.ligneDispensation.updateMany({
          where: { id: { in: lignesFacturables.map((l) => l.id) } },
          data: { factureMensuelleId: f.id, reporteeMoisSuivant: false },
        });
      }
      if (lignesEncoreEnLitige.length > 0) {
        await tx.ligneDispensation.updateMany({
          where: { id: { in: lignesEncoreEnLitige.map((l) => l.id) } },
          data: { reporteeMoisSuivant: true },
        });
      }
      const soumise = await tx.factureMensuellePharmacie.update({
        where: { id: f.id },
        data: { statut: 'SOUMISE', dateSoumission: new Date() },
      });
      await this.audit(tx, ctx.userId, 'SOUMISSION_FACTURE_MENSUELLE', 'factures_mensuelles_pharmacie', f.id, {
        periode: dto.periode,
        montantTotal: montantTotal.toFixed(2),
        nbLignesIncluses: lignesFacturables.length,
        nbLignesExclues: toutesLignes.length - lignesFacturables.length,
      });
      return soumise;
    });

    return {
      id: facture.id,
      periode: facture.periode,
      statut: facture.statut,
      montantTotal: facture.montantTotal.toFixed(2),
      dateSoumission: facture.dateSoumission,
      nbLignesIncluses: lignesFacturables.length,
      nbLignesExclues: toutesLignes.length - lignesFacturables.length,
    };
  }

  /** Détail ligne-par-ligne d'une facture mensuelle — le verrou d'accès de
   * ASSUREUR_COMPTABLE (statut ≥ VALIDEE_PHARMACIEN_CONSEIL) est vérifié
   * explicitement ici, pas seulement par le filtre des listes : un accès
   * direct par id doit être refusé de la même façon. */
  async obtenirFactureMensuelle(user: AuthenticatedUser, factureMensuelleId: string) {
    const ctx = await this.contexteAppelant(user);
    const facture = await this.prisma.factureMensuellePharmacie.findFirst({
      where: { id: factureMensuelleId, organisationId: ctx.organisationId },
      include: {
        pharmacie: { select: { nom: true } },
        lignes: { include: { ligneOrdonnance: { select: { denominationMedicament: true } } } },
      },
    });
    if (!facture) {
      throw new NotFoundException('Facture mensuelle introuvable.');
    }

    const estPharmacieConcernee = ctx.pharmacieId && ctx.pharmacieId === facture.pharmacieId;
    const estPharmacienConseil = ctx.roleChain.includes(ROLE_PHARMACIEN_CONSEIL);
    const estComptable = ctx.roleChain.includes(ROLE_COMPTABLE_FACTURE_MENSUELLE);
    if (!estPharmacieConcernee && !estPharmacienConseil && !estComptable) {
      throw new ForbiddenException("Vous n'avez pas accès à cette facture mensuelle.");
    }

    const enLitige = await this.chargerLignesEnLitige(facture.lignes.map((l) => l.ligneOrdonnanceId));

    return {
      id: facture.id,
      pharmacie: facture.pharmacie.nom,
      periode: facture.periode,
      statut: facture.statut,
      montantTotal: facture.montantTotal.toFixed(2),
      nbLignesReportees: facture.nbLignesReportees,
      dateSoumission: facture.dateSoumission,
      dateValidation: facture.dateValidation,
      dateProgrammation: facture.dateProgrammation,
      datePaiement: facture.datePaiement,
      lignes: facture.lignes.map((l) => ({
        id: l.id,
        ligneOrdonnanceId: l.ligneOrdonnanceId,
        denominationMedicament: l.medicamentSubstitue ?? l.ligneOrdonnance.denominationMedicament,
        quantite: l.quantite,
        montantAssurance: l.montantAssurance.toFixed(2),
        enLitige: enLitige.has(l.ligneOrdonnanceId),
      })),
    };
  }

  /** Côté PHARMACIE : historique de SES factures mensuelles, tout statut. */
  async listerMesFacturesMensuelles(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.pharmacieId) {
      throw new ForbiddenException("Réservé au personnel d'une pharmacie du réseau.");
    }
    const factures = await this.prisma.factureMensuellePharmacie.findMany({
      where: { pharmacieId: ctx.pharmacieId },
      orderBy: { periode: 'desc' },
    });
    return factures.map((f) => ({
      id: f.id,
      periode: f.periode,
      statut: f.statut,
      montantTotal: f.montantTotal.toFixed(2),
      dateSoumission: f.dateSoumission,
      dateValidation: f.dateValidation,
      datePaiement: f.datePaiement,
    }));
  }

  /** Côté PHARMACIEN CONSEIL : « Factures mensuelles à valider » (SOUMISE, organisation entière). */
  async listerFacturesMensuellesAValider(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_PHARMACIEN_CONSEIL)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_PHARMACIEN_CONSEIL.');
    }
    const factures = await this.prisma.factureMensuellePharmacie.findMany({
      where: { organisationId: ctx.organisationId, statut: 'SOUMISE' },
      include: { pharmacie: { select: { nom: true } } },
      orderBy: { dateSoumission: 'asc' },
    });
    return factures.map((f) => ({
      id: f.id,
      pharmacie: f.pharmacie.nom,
      periode: f.periode,
      statut: f.statut,
      montantTotal: f.montantTotal.toFixed(2),
      dateSoumission: f.dateSoumission,
    }));
  }

  /**
   * Tranche la validation — réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_CONSEIL.
   * Double sécurité explicite : ne fait AUCUNE confiance à l'agrégation faite
   * à la soumission — recharge les lignes stampées par CETTE facture et
   * revérifie leur statut de litige à l'instant présent (une contestation a
   * pu être ouverte APRÈS la soumission, AVANT la validation).
   */
  async validerFactureMensuelle(
    user: AuthenticatedUser,
    factureMensuelleId: string,
    dto: ValiderFactureMensuelleDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_PHARMACIEN_CONSEIL)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_PHARMACIEN_CONSEIL.');
    }

    const facture = await this.prisma.factureMensuellePharmacie.findFirst({
      where: { id: factureMensuelleId, organisationId: ctx.organisationId },
      include: { lignes: { select: { ligneOrdonnanceId: true } } },
    });
    if (!facture) {
      throw new NotFoundException('Facture mensuelle introuvable.');
    }
    if (facture.statut !== 'SOUMISE') {
      throw new ConflictException(
        `Cette facture n'est pas en attente de validation (statut actuel : ${facture.statut}).`,
      );
    }

    const enLitige = await this.chargerLignesEnLitige(facture.lignes.map((l) => l.ligneOrdonnanceId));
    if (enLitige.size > 0) {
      throw new ConflictException({
        message: `Validation impossible : ${enLitige.size} ligne(s) déjà incluse(s) sont désormais en litige (contestation ouverte après la soumission) — à régler avant de revalider.`,
        ligneOrdonnanceIdsEnLitige: [...enLitige],
      });
    }

    if (dto.decision === 'A_CORRIGER') {
      const maj = await this.prisma.$transaction(async (tx) => {
        await tx.ligneDispensation.updateMany({
          where: { factureMensuelleId: facture.id },
          data: { factureMensuelleId: null },
        });
        const f = await tx.factureMensuellePharmacie.update({
          where: { id: facture.id },
          data: { statut: 'EN_PREPARATION', dateSoumission: null },
        });
        await this.audit(
          tx,
          ctx.userId,
          'FACTURE_MENSUELLE_PHARMACIE_A_CORRIGER',
          'factures_mensuelles_pharmacie',
          f.id,
          { nbLignesLiberees: facture.lignes.length },
        );
        return f;
      });
      return { ...maj, montantTotal: maj.montantTotal.toFixed(2) };
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const f = await tx.factureMensuellePharmacie.update({
        where: { id: factureMensuelleId },
        data: { statut: 'VALIDEE_PHARMACIEN_CONSEIL', valideParId: ctx.userId, dateValidation: new Date() },
      });
      await this.audit(tx, ctx.userId, 'VALIDATION_FACTURE_MENSUELLE', 'factures_mensuelles_pharmacie', f.id, {
        montantTotal: f.montantTotal.toFixed(2),
      });
      return f;
    });

    return { ...maj, montantTotal: maj.montantTotal.toFixed(2) };
  }

  /** Côté COMPTABLE : « Factures pharmacie » — TOUT statut, organisation
   * entière (accès en revue global). Le tri par catégorie (du mois, en
   * paiement, réglées…) reste un filtrage côté écran. */
  async listerFacturesMensuellesPourComptable(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_COMPTABLE_FACTURE_MENSUELLE)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_COMPTABLE.');
    }
    const factures = await this.prisma.factureMensuellePharmacie.findMany({
      where: { organisationId: ctx.organisationId },
      include: { pharmacie: { select: { nom: true } } },
      orderBy: { periode: 'desc' },
    });
    return factures.map((f) => ({
      id: f.id,
      pharmacie: f.pharmacie.nom,
      periode: f.periode,
      statut: f.statut,
      montantTotal: f.montantTotal.toFixed(2),
      nbLignesReportees: f.nbLignesReportees,
      dateSoumission: f.dateSoumission,
      dateValidation: f.dateValidation,
      dateProgrammation: f.dateProgrammation,
      datePaiement: f.datePaiement,
    }));
  }

  private async chargerFacturePourComptable(ctx: ContexteAppelant, factureMensuelleId: string) {
    if (!ctx.roleChain.includes(ROLE_COMPTABLE_FACTURE_MENSUELLE)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_COMPTABLE.');
    }
    const facture = await this.prisma.factureMensuellePharmacie.findFirst({
      where: { id: factureMensuelleId, organisationId: ctx.organisationId },
      include: { lignes: { select: { id: true, ligneOrdonnanceId: true, montantAssurance: true } } },
    });
    if (!facture) {
      throw new NotFoundException('Facture mensuelle introuvable.');
    }
    return facture;
  }

  /**
   * Retire manuellement une ligne encore EN LITIGE d'une facture — réservé
   * EXCLUSIVEMENT à ASSUREUR_COMPTABLE, applicable tant que la facture n'a pas
   * dépassé la validation du pharmacien conseil (SOUMISE ou
   * VALIDEE_PHARMACIEN_CONSEIL). Marquée `reporteeMoisSuivant` — réintégrée
   * automatiquement dès que le litige associé n'est plus actif (VALIDEE), ou
   * jamais si REJETEE.
   */
  async decocherLigneContestee(user: AuthenticatedUser, factureMensuelleId: string, ligneId: string) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_COMPTABLE_FACTURE_MENSUELLE)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_COMPTABLE.');
    }
    const facture = await this.chargerFacturePourComptable(ctx, factureMensuelleId);
    if (!['SOUMISE', 'VALIDEE_PHARMACIEN_CONSEIL'].includes(facture.statut)) {
      throw new ConflictException(
        `Impossible de retirer une ligne : cette facture est déjà ${facture.statut}.`,
      );
    }
    const ligne = facture.lignes.find((l) => l.id === ligneId);
    if (!ligne) {
      throw new NotFoundException("Cette ligne n'appartient pas à cette facture.");
    }
    const enLitige = await this.chargerLignesEnLitige([ligne.ligneOrdonnanceId]);
    if (!enLitige.has(ligne.ligneOrdonnanceId)) {
      throw new BadRequestException("Cette ligne n'est pas en litige — rien à retirer.");
    }

    const montantTotal = new Decimal(facture.montantTotal.toString()).sub(
      new Decimal(ligne.montantAssurance.toString()),
    );

    const maj = await this.prisma.$transaction(async (tx) => {
      await tx.ligneDispensation.update({
        where: { id: ligne.id },
        data: { factureMensuelleId: null, reporteeMoisSuivant: true },
      });
      const f = await tx.factureMensuellePharmacie.update({
        where: { id: facture.id },
        data: { montantTotal: montantTotal.toFixed(2), nbLignesReportees: { increment: 1 } },
      });
      await this.audit(
        tx,
        ctx.userId,
        'DECOCHAGE_LIGNE_CONTESTEE_FACTURE_MENSUELLE',
        'factures_mensuelles_pharmacie',
        f.id,
        { ligneId: ligne.id, ligneOrdonnanceId: ligne.ligneOrdonnanceId, montantAssurance: ligne.montantAssurance.toFixed(2) },
      );
      return f;
    });

    return { ...maj, montantTotal: maj.montantTotal.toFixed(2) };
  }

  /**
   * Valide une facture pour paiement — réservé EXCLUSIVEMENT à
   * ASSUREUR_COMPTABLE, uniquement si AUCUNE ligne en litige non décochée ne
   * subsiste. VALIDEE_PHARMACIEN_CONSEIL → PROGRAMMEE_PAIEMENT.
   */
  async validerPourPaiement(user: AuthenticatedUser, factureMensuelleId: string) {
    const ctx = await this.contexteAppelant(user);
    const facture = await this.chargerFacturePourComptable(ctx, factureMensuelleId);
    if (facture.statut !== 'VALIDEE_PHARMACIEN_CONSEIL') {
      throw new ConflictException(
        `Cette facture est déjà ${facture.statut} — la validation pour paiement ne s'applique qu'après validation du pharmacien conseil.`,
      );
    }
    const enLitige = await this.chargerLignesEnLitige(facture.lignes.map((l) => l.ligneOrdonnanceId));
    if (enLitige.size > 0) {
      throw new ConflictException({
        message: `${enLitige.size} ligne(s) de cette facture sont encore en litige — décochez-les (decocherLigneContestee) avant de valider pour paiement.`,
        ligneOrdonnanceIdsEnLitige: [...enLitige],
      });
    }
    const maj = await this.prisma.$transaction(async (tx) => {
      const f = await tx.factureMensuellePharmacie.update({
        where: { id: factureMensuelleId },
        data: { statut: 'PROGRAMMEE_PAIEMENT', dateProgrammation: new Date() },
      });
      await this.audit(tx, ctx.userId, 'VALIDATION_PAIEMENT_FACTURE_MENSUELLE', 'factures_mensuelles_pharmacie', f.id, {});
      return f;
    });
    return { ...maj, montantTotal: maj.montantTotal.toFixed(2) };
  }

  // Le paiement RÉEL (débit d'un compte financier) est désormais réservé à
  // `PaymentService.payerFacture` (module payment/) — l'ancien
  // `marquerFactureMensuellePayee` (symbolique) a été retiré.

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

  /**
   * Substitution — capacité ADDITIVE : le pharmacien titulaire de SA pharmacie
   * (comme partout ailleurs dans ce module), OU ASSUREUR_PHARMACIEN_CONSEIL
   * (organisation entière, jamais scopé à une pharmacie précise). Ni la
   * caissière ni le comptable pharmacie, ni aucun autre rôle ASSUREUR.
   */
  private assertPeutSubstituer(ctx: ContexteAppelant): 'PHARMACIEN' | 'PHARMACIEN_CONSEIL' {
    if (ctx.roleChain.includes(ROLE_PHARMACIEN_CONSEIL)) {
      return 'PHARMACIEN_CONSEIL';
    }
    if (ctx.roleChain.includes(ROLE_PHARMACIEN_SEUL) && ctx.pharmacieId) {
      return 'PHARMACIEN';
    }
    throw new ForbiddenException(
      'Réservé au pharmacien titulaire de la pharmacie ou au pharmacien conseil.',
    );
  }

  /**
   * Lignes actuellement EN LITIGE (contestation OUVERT/JUSTIFICATION_RECUE =
   * temporaire, ou REJETEE = définitif — module `contestation/`) — exclues de
   * tout calcul de montant facturable, `enLitige: true` renvoyé à la place
   * partout où le montant de la ligne apparaît. Seul VALIDEE débloque.
   */
  private async chargerLignesEnLitige(ligneOrdonnanceIds: string[]): Promise<Set<string>> {
    if (ligneOrdonnanceIds.length === 0) {
      return new Set();
    }
    const contestations = await this.prisma.contestationPrescription.findMany({
      where: {
        ligneOrdonnanceId: { in: ligneOrdonnanceIds },
        statut: { in: STATUTS_CONTESTATION_EN_LITIGE as unknown as string[] },
      },
      select: { ligneOrdonnanceId: true },
    });
    return new Set(contestations.map((c) => c.ligneOrdonnanceId));
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
