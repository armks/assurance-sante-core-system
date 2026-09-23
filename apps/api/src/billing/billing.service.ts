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
  CalculerCotisationDto,
  CreateGrilleDto,
  EnregistrerPaiementDto,
  GenererCotisationsDto,
} from './dto/billing.dto';
import {
  CalculCotisation,
  ContexteAppelant,
  ROLES_GESTION_BILLING,
  ROLES_GESTION_GRILLES_TARIFAIRES,
} from './billing.types';

type Db = PrismaService | Prisma.TransactionClient;

const UUID_ZERO = '00000000-0000-0000-0000-000000000000';

/** Vue minimale d'une police pour le calcul. */
interface PolicePourCalcul {
  id: string;
  organisationId: string;
  souscripteurId: string;
  produitId: string;
  statut: string;
}

/**
 * BillingService — tarification collective (v9 phases 2.5 / 2.6, §2.2) et appels
 * de cotisation.
 *
 * Priorité de tarification : grille NÉGOCIÉE (propre au souscripteur) > grille
 * STANDARD (produit), par tranche d'âge. Si le souscripteur est une COLLECTIVITE
 * avec un plan de paiement subventionné, on applique `part_membre_pourcent`.
 * Tous les calculs financiers passent par decimal.js — jamais `number` natif.
 *
 * Défense en profondeur : org + rôle (roleChain) EN PLUS des policies RLS
 * (`profil_a_role`, prisma/sql/006).
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  // --- Grilles tarifaires ---------------------------------------------

  async creerGrille(user: AuthenticatedUser, dto: CreateGrilleDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestionGrilles(ctx);

    if (dto.trancheAgeMax < dto.trancheAgeMin) {
      throw new BadRequestException(
        'tranche_age_max doit être ≥ tranche_age_min.',
      );
    }
    const produit = await this.prisma.produit.findFirst({
      where: {
        id: dto.produitId,
        organisationId: ctx.organisationId,
        deletedAt: null,
      },
    });
    if (!produit) {
      throw new NotFoundException('Produit introuvable.');
    }
    if (dto.souscripteurId) {
      const s = await this.prisma.souscripteur.findFirst({
        where: {
          id: dto.souscripteurId,
          organisationId: ctx.organisationId,
          deletedAt: null,
        },
      });
      if (!s) {
        throw new NotFoundException('Souscripteur introuvable.');
      }
    }

    const existe = await this.prisma.grilleTarifaire.findFirst({
      where: {
        produitId: dto.produitId,
        souscripteurId: dto.souscripteurId ?? null,
        trancheAgeMin: dto.trancheAgeMin,
        trancheAgeMax: dto.trancheAgeMax,
        deletedAt: null,
      },
    });
    if (existe) {
      throw new ConflictException(
        `Une grille ${dto.souscripteurId ? 'négociée' : 'standard'} existe déjà pour ce produit et cette tranche d'âge (${dto.trancheAgeMin}-${dto.trancheAgeMax}).`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const grille = await tx.grilleTarifaire.create({
        data: {
          organisationId: ctx.organisationId,
          produitId: dto.produitId,
          trancheAgeMin: dto.trancheAgeMin,
          trancheAgeMax: dto.trancheAgeMax,
          souscripteurId: dto.souscripteurId ?? null,
          montantMensuel: new Decimal(dto.montantMensuel).toFixed(2),
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CREATION_GRILLE_TARIFAIRE',
        grille.id,
        {
          produitId: dto.produitId,
          souscripteurId: dto.souscripteurId ?? null,
          tranche: [dto.trancheAgeMin, dto.trancheAgeMax],
          montantMensuel: new Decimal(dto.montantMensuel).toFixed(2),
        },
        'grilles_tarifaires',
      );
      return grille;
    });
  }

  async listerGrilles(
    user: AuthenticatedUser,
    filtres: { produitId?: string; souscripteurId?: string },
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertLectureAssureur(ctx);
    return this.prisma.grilleTarifaire.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(filtres.produitId ? { produitId: filtres.produitId } : {}),
        ...(filtres.souscripteurId
          ? { souscripteurId: filtres.souscripteurId }
          : {}),
      },
      orderBy: [{ produitId: 'asc' }, { trancheAgeMin: 'asc' }],
      include: {
        produit: { select: { nom: true, version: true } },
        souscripteur: { select: { nom: true, type: true } },
      },
    });
  }

  // --- Calcul de cotisation -----------------------------------------

  async calculerCotisation(
    user: AuthenticatedUser,
    dto: CalculerCotisationDto,
  ): Promise<CalculCotisation> {
    const ctx = await this.contexteAppelant(user);
    this.assertLectureAssureur(ctx);
    const police = await this.chargerPoliceGestion(ctx.organisationId, dto.policeId);
    return this.calculer(police, dto.age);
  }

  private async calculer(
    police: PolicePourCalcul,
    age: number,
  ): Promise<CalculCotisation> {
    // 1. tarif NÉGOCIÉ pour ce souscripteur ?
    let grille = await this.prisma.grilleTarifaire.findFirst({
      where: {
        produitId: police.produitId,
        souscripteurId: police.souscripteurId,
        deletedAt: null,
        trancheAgeMin: { lte: age },
        trancheAgeMax: { gte: age },
      },
    });
    let source: 'NEGOCIE' | 'STANDARD' = 'NEGOCIE';

    // 2. sinon tarif STANDARD (souscripteur_id null)
    if (!grille) {
      grille = await this.prisma.grilleTarifaire.findFirst({
        where: {
          produitId: police.produitId,
          souscripteurId: null,
          deletedAt: null,
          trancheAgeMin: { lte: age },
          trancheAgeMax: { gte: age },
        },
      });
      source = 'STANDARD';
    }
    if (!grille) {
      throw new NotFoundException(
        `Aucune grille tarifaire applicable (produit ${police.produitId}, âge ${age}).`,
      );
    }

    const tarifBase = new Decimal(grille.montantMensuel.toString());
    let montant = tarifBase;
    let partMembre = 100;

    // 3. subvention COLLECTIVITE
    const souscripteur = await this.prisma.souscripteur.findUnique({
      where: { id: police.souscripteurId },
    });
    if (souscripteur?.type === 'COLLECTIVITE') {
      const plan = await this.prisma.planPaiementCollectivite.findFirst({
        where: { souscripteurId: police.souscripteurId, deletedAt: null },
      });
      if (plan) {
        partMembre = new Decimal(plan.partMembrePourcent.toString()).toNumber();
        montant = tarifBase
          .mul(plan.partMembrePourcent.toString())
          .div(100);
      }
    }

    return {
      montantDu: montant.toFixed(2),
      tarifBase: tarifBase.toFixed(2),
      source,
      partMembrePourcent: partMembre,
      grilleTarifaireId: grille.id,
    };
  }

  // --- Génération des cotisations d'une période ---------------------

  async genererCotisationsPeriode(
    user: AuthenticatedUser,
    policeId: string,
    dto: GenererCotisationsDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const police = await this.chargerPoliceGestion(ctx.organisationId, policeId);
    if (police.statut !== 'ACTIVE') {
      throw new ConflictException(
        `Génération impossible : la police est ${police.statut} (attendu ACTIVE).`,
      );
    }

    const periode = new Date(dto.periode);
    const premierJourDuMois = this.premierJourDuMois(periode);
    const dateEcheance = dto.dateEcheance
      ? new Date(dto.dateEcheance)
      : this.plusJours(periode, 30);

    const resultats: unknown[] = [];
    let generees = 0;
    let reportees = 0;

    for (const adherent of dto.adherents) {
      const existe = await this.prisma.cotisation.findFirst({
        where: {
          policeId,
          adherentId: adherent.adherentId,
          periode,
          deletedAt: null,
        },
      });
      if (existe) {
        resultats.push({ ...existe, deja: true });
        continue;
      }

      // Coupure de facturation mensuelle (prisma/sql/052) : un adhérent
      // PRINCIPAL doit être validé par ASSUREUR_EXPLOITATION AVANT le 1er du
      // mois facturé pour y être inclus — jamais appliqué aux bénéficiaires
      // (pas de champ équivalent sur `beneficiaires`, ni de génération
      // individuelle les concernant ici).
      const adherentDB = await this.prisma.adherent.findFirst({
        where: { id: adherent.adherentId, organisationId: ctx.organisationId, deletedAt: null },
        select: { id: true, dateValidation: true },
      });
      if (!adherentDB) {
        throw new NotFoundException(`Adhérent ${adherent.adherentId} introuvable.`);
      }
      if (!adherentDB.dateValidation || adherentDB.dateValidation >= premierJourDuMois) {
        resultats.push({
          adherentId: adherent.adherentId,
          reportee: true,
          motif: adherentDB.dateValidation
            ? `Validé le ${adherentDB.dateValidation.toISOString().slice(0, 10)} — après la coupure du 1er du mois, reporté au mois suivant.`
            : 'Adhérent pas encore validé par ASSUREUR_EXPLOITATION — reporté tant que non validé.',
        });
        reportees += 1;
        continue;
      }

      const calcul = await this.calculer(police, adherent.age);
      const cotisation = await this.prisma.$transaction(async (tx) => {
        const c = await tx.cotisation.create({
          data: {
            policeId,
            adherentId: adherent.adherentId,
            periode,
            montantDu: calcul.montantDu,
            dateEcheance,
            statut: 'A_PAYER',
          },
        });
        await this.audit(
          tx,
          ctx.userId,
          'GENERATION_COTISATION',
          c.id,
          {
            policeId,
            adherentId: adherent.adherentId,
            periode: dto.periode.slice(0, 10),
            montantDu: calcul.montantDu,
            source: calcul.source,
          },
          'cotisations',
        );
        return c;
      });
      resultats.push(cotisation);
      generees += 1;
    }

    return { periode: dto.periode.slice(0, 10), generees, reportees, cotisations: resultats };
  }

  /**
   * Adhérents PRINCIPAUX (jamais les bénéficiaires) d'un souscripteur déjà
   * validés avant la coupure du 1er du mois de `periode` — ceux éligibles à
   * la facturation de CE mois (écran comptable « Liste des adhérents pour
   * facturation »). `nbBeneficiaires` reflète l'état ACTUEL (pas de coupure
   * sur les bénéficiaires — un ajout en cours de mois y apparaît aussitôt).
   */
  async listerAdherentsPourFacturation(
    user: AuthenticatedUser,
    souscripteurId: string,
    periodeStr: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

    const souscripteur = await this.prisma.souscripteur.findFirst({
      where: { id: souscripteurId, organisationId: ctx.organisationId, deletedAt: null },
    });
    if (!souscripteur) {
      throw new NotFoundException('Souscripteur introuvable.');
    }

    const periode = new Date(periodeStr);
    const premierJourDuMois = this.premierJourDuMois(periode);

    const adherents = await this.prisma.adherent.findMany({
      where: {
        souscripteurId,
        organisationId: ctx.organisationId,
        statut: 'ACTIF',
        deletedAt: null,
        dateValidation: { not: null, lt: premierJourDuMois },
      },
      include: {
        beneficiaires: { where: { deletedAt: null } },
        police: { select: { id: true, numeroPolice: true, statut: true } },
      },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });

    return adherents.map((a) => ({
      id: a.id,
      numeroAdherent: a.numeroAdherent,
      nom: a.nom,
      prenom: a.prenom,
      dateNaissance: a.dateNaissance,
      age: this.calculerAge(a.dateNaissance, periode),
      dateValidation: a.dateValidation,
      policeId: a.policeId,
      police: a.police,
      nbBeneficiaires: a.beneficiaires.length,
    }));
  }

  /**
   * « Consolider et valider la facture société » (écran comptable) : génère
   * les cotisations individuelles des adhérents éligibles (réutilise
   * `genererCotisationsPeriode` — coupure de facturation appliquée une seule
   * fois, jamais dupliquée), puis crée UNE cotisation consolidée au niveau
   * société (`Cotisation.societeId` renseigné, `adherentId` null — même
   * principe « exactement l'un des deux » que `PaiementGroupeFacture`)
   * sommant leurs montants — la facture globale par société cliente du mois.
   */
  async consoliderFacturationSociete(
    user: AuthenticatedUser,
    souscripteurId: string,
    periodeStr: string,
    dateEcheanceStr?: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

    const souscripteur = await this.prisma.souscripteur.findFirst({
      where: { id: souscripteurId, organisationId: ctx.organisationId, deletedAt: null },
    });
    if (!souscripteur) {
      throw new NotFoundException('Souscripteur introuvable.');
    }

    const police = await this.prisma.police.findFirst({
      where: { souscripteurId, organisationId: ctx.organisationId, statut: 'ACTIVE', deletedAt: null },
    });
    if (!police) {
      throw new ConflictException('Aucune police ACTIVE pour ce souscripteur — consolidation impossible.');
    }

    const periode = new Date(periodeStr);

    const dejaConsolidee = await this.prisma.cotisation.findFirst({
      where: { societeId: souscripteurId, periode, deletedAt: null },
    });
    if (dejaConsolidee) {
      throw new ConflictException(
        `Une facture société consolidée existe déjà pour cette période (${new Decimal(dejaConsolidee.montantDu.toString()).toFixed(2)} F).`,
      );
    }

    const premierJourDuMois = this.premierJourDuMois(periode);
    const eligibles = await this.prisma.adherent.findMany({
      where: {
        souscripteurId,
        organisationId: ctx.organisationId,
        statut: 'ACTIF',
        deletedAt: null,
        dateValidation: { not: null, lt: premierJourDuMois },
      },
      select: { id: true, dateNaissance: true },
    });
    if (eligibles.length === 0) {
      throw new ConflictException(
        'Aucun adhérent principal éligible (validé avant la coupure du 1er du mois) pour cette période.',
      );
    }

    const generation = await this.genererCotisationsPeriode(user, police.id, {
      periode: periodeStr,
      dateEcheance: dateEcheanceStr,
      adherents: eligibles.map((a) => ({
        adherentId: a.id,
        age: this.calculerAge(a.dateNaissance, periode),
      })),
    });

    const dateEcheance = dateEcheanceStr ? new Date(dateEcheanceStr) : this.plusJours(periode, 30);
    const cotisationsIndividuelles = await this.prisma.cotisation.findMany({
      where: {
        policeId: police.id,
        periode,
        deletedAt: null,
        adherentId: { in: eligibles.map((a) => a.id) },
      },
    });
    const montantTotal = cotisationsIndividuelles.reduce(
      (acc, c) => acc.add(new Decimal(c.montantDu.toString())),
      new Decimal(0),
    );

    const consolidee = await this.prisma.$transaction(async (tx) => {
      const c = await tx.cotisation.create({
        data: {
          policeId: police.id,
          adherentId: null,
          societeId: souscripteurId,
          periode,
          montantDu: montantTotal.toFixed(2),
          dateEcheance,
          statut: 'A_PAYER',
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CONSOLIDATION_FACTURE_SOCIETE',
        c.id,
        {
          souscripteurId,
          periode: periodeStr.slice(0, 10),
          nbAdherentsFactures: generation.generees,
          nbAdherentsReportes: generation.reportees,
          montantTotal: montantTotal.toFixed(2),
        },
        'cotisations',
      );
      return c;
    });

    return {
      ...consolidee,
      montantDu: consolidee.montantDu.toFixed(2),
      nbAdherentsFactures: generation.generees,
      nbAdherentsReportes: generation.reportees,
    };
  }

  async listerCotisationsPolice(user: AuthenticatedUser, policeId: string) {
    const ctx = await this.contexteAppelant(user);
    await this.chargerPoliceLecture(ctx, policeId); // vérifie la visibilité
    return this.prisma.cotisation.findMany({
      where: { policeId, deletedAt: null },
      orderBy: { periode: 'desc' },
    });
  }

  async listerCotisations(
    user: AuthenticatedUser,
    filtres: { statut?: string; policeId?: string },
  ) {
    const ctx = await this.contexteAppelant(user);
    return this.prisma.cotisation.findMany({
      where: {
        deletedAt: null,
        police: {
          organisationId: ctx.organisationId,
          ...(ctx.entite !== 'ASSUREUR'
            ? { souscripteurId: ctx.societeId ?? UUID_ZERO }
            : {}),
        },
        ...(filtres.statut ? { statut: filtres.statut } : {}),
        ...(filtres.policeId ? { policeId: filtres.policeId } : {}),
      },
      orderBy: { dateEcheance: 'asc' },
      include: {
        police: {
          select: {
            numeroPolice: true,
            souscripteur: { select: { nom: true, type: true } },
            produit: { select: { nom: true } },
          },
        },
      },
    });
  }

  // --- Paiement ---------------------------------------------------

  async enregistrerPaiement(
    user: AuthenticatedUser,
    cotisationId: string,
    dto: EnregistrerPaiementDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const cotisation = await this.chargerCotisationGestion(
      ctx.organisationId,
      cotisationId,
    );
    if (cotisation.statut === 'ANNULEE') {
      throw new ConflictException('Cotisation annulée.');
    }

    const montantPaye = new Decimal(cotisation.montantPaye.toString())
      .plus(dto.montant)
      .toDecimalPlaces(2);
    const totalDu = new Decimal(cotisation.montantDu.toString()).plus(
      cotisation.penaliteAppliquee.toString(),
    );
    const statut = montantPaye.gte(totalDu)
      ? 'PAYEE'
      : cotisation.statut === 'EN_RETARD'
        ? 'EN_RETARD'
        : 'A_PAYER';

    await this.prisma.$transaction(async (tx) => {
      await tx.cotisation.update({
        where: { id: cotisationId },
        data: { montantPaye: montantPaye.toFixed(2), statut },
      });
      await this.audit(
        tx,
        ctx.userId,
        'ENREGISTREMENT_PAIEMENT',
        cotisationId,
        {
          montant: new Decimal(dto.montant).toFixed(2),
          montantPaye: montantPaye.toFixed(2),
          statut,
        },
        'cotisations',
      );
    });
    return this.prisma.cotisation.findUnique({ where: { id: cotisationId } });
  }

  // --- Tâche : passage EN_RETARD -------------------------------

  async marquerEnRetard(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

    const echues = await this.prisma.cotisation.findMany({
      where: {
        statut: 'A_PAYER',
        dateEcheance: { lt: this.aujourdhui() },
        deletedAt: null,
        police: { organisationId: ctx.organisationId, deletedAt: null },
      },
      include: { police: { select: { produitId: true } } },
    });

    let compte = 0;
    for (const cotisation of echues) {
      const taux = await this.tauxPenaliteProduit(cotisation.police.produitId);
      const penalite = new Decimal(cotisation.montantDu.toString())
        .mul(taux)
        .toDecimalPlaces(2);

      await this.prisma.$transaction(async (tx) => {
        await tx.cotisation.update({
          where: { id: cotisation.id },
          data: {
            statut: 'EN_RETARD',
            penaliteAppliquee: penalite.toFixed(2),
          },
        });
        await this.audit(
          tx,
          ctx.userId,
          'PASSAGE_EN_RETARD',
          cotisation.id,
          {
            montantDu: cotisation.montantDu.toString(),
            tauxPenalite: taux.toString(),
            penalite: penalite.toFixed(2),
          },
          'cotisations',
        );
      });
      compte += 1;
    }
    return { misEnRetard: compte };
  }

  /**
   * Taux de pénalité par produit (v14 §7). La table `baremes_penalite` n'est pas
   * encore créée — mécanisme en place, taux 0 par défaut pour l'instant.
   */
  private async tauxPenaliteProduit(_produitId: string): Promise<Decimal> {
    return new Decimal(0);
  }

  // --- Autorisation / scoping ---------------------------------

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

  private assertLectureAssureur(ctx: ContexteAppelant): void {
    if (ctx.entite !== 'ASSUREUR') {
      throw new ForbiddenException("Accès réservé aux profils de l'assureur.");
    }
  }

  private assertGestion(ctx: ContexteAppelant): void {
    const autorise = ctx.roleChain.some((code) =>
      (ROLES_GESTION_BILLING as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        'Rôle insuffisant : la facturation est réservée à ASSUREUR_COMPTABLE et ASSUREUR_INFORMATIQUE.',
      );
    }
  }

  /** Grilles tarifaires (standard ET négociées) — périmètre plus étroit que
   * `assertGestion` : ASSUREUR_COMPTABLE en est exclu (voir
   * `ROLES_GESTION_GRILLES_TARIFAIRES`). */
  private assertGestionGrilles(ctx: ContexteAppelant): void {
    const autorise = ctx.roleChain.some((code) =>
      (ROLES_GESTION_GRILLES_TARIFAIRES as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        'Rôle insuffisant : la gestion des grilles tarifaires est réservée à ASSUREUR_INFORMATIQUE.',
      );
    }
  }

  private async chargerPoliceGestion(
    organisationId: string,
    id: string,
  ): Promise<PolicePourCalcul> {
    const police = await this.prisma.police.findFirst({
      where: { id, organisationId, deletedAt: null },
      select: {
        id: true,
        organisationId: true,
        souscripteurId: true,
        produitId: true,
        statut: true,
      },
    });
    if (!police) {
      throw new NotFoundException('Police introuvable.');
    }
    return police;
  }

  private async chargerPoliceLecture(ctx: ContexteAppelant, id: string) {
    const police = await this.prisma.police.findFirst({
      where: {
        id,
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(ctx.entite !== 'ASSUREUR'
          ? { souscripteurId: ctx.societeId ?? UUID_ZERO }
          : {}),
      },
    });
    if (!police) {
      throw new NotFoundException('Police introuvable.');
    }
    return police;
  }

  private async chargerCotisationGestion(organisationId: string, id: string) {
    const cotisation = await this.prisma.cotisation.findFirst({
      where: {
        id,
        deletedAt: null,
        police: { organisationId },
      },
    });
    if (!cotisation) {
      throw new NotFoundException('Cotisation introuvable.');
    }
    return cotisation;
  }

  // --- Helpers dates ---------------------------------------

  private aujourdhui(): Date {
    const d = new Date();
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
  }

  private plusJours(d: Date, n: number): Date {
    return new Date(d.getTime() + n * 86_400_000);
  }

  /** Premier jour (UTC minuit) du mois de `d` — coupure de facturation. */
  private premierJourDuMois(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }

  /** Âge en années révolues à la date `reference`. */
  private calculerAge(dateNaissance: Date, reference: Date): number {
    let age = reference.getUTCFullYear() - dateNaissance.getUTCFullYear();
    const anniversaireCetteAnnee = new Date(
      Date.UTC(reference.getUTCFullYear(), dateNaissance.getUTCMonth(), dateNaissance.getUTCDate()),
    );
    if (reference < anniversaireCetteAnnee) age -= 1;
    return age;
  }

  /** Écriture d'audit — toujours via la fonction Postgres `log_audit()` (v9 §1.6). */
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
