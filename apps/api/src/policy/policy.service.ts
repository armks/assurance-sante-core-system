import type { ChangerFormuleMasseDto, ChangerFormulePoliceDto } from './dto/policy.dto';
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
import { DependancesService } from '../dependances/dependances.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAvenantDto,
  CreateDevisDto,
  SimulerAvenantDto,
  SouscrireDto,
  UpdateAvenantDto,
  UpdatePoliceDto,
} from './dto/policy.dto';
import {
  ActionPolice,
  ContexteAppelant,
  LIBELLE_TRANSITION,
  ROLES_GESTION_POLICE,
  STATUTS_POLICE,
  STATUTS_POLICE_FINAUX,
  StatutPolice,
  TRANSITIONS_POLICE,
} from './policy.types';

type Db = PrismaService | Prisma.TransactionClient;

const UUID_ZERO = '00000000-0000-0000-0000-000000000000';
const MS_PAR_JOUR = 86_400_000;

/**
 * PolicyService — cycle de vie des polices (machine à états stricte) et des
 * avenants (v9 phase 2.2 / v3 §3).
 *
 * - Une police ne peut être créée / souscrite que sur un produit PUBLIE.
 * - `changerStatut` applique TRANSITIONS_POLICE : toute transition non listée
 *   échoue explicitement (ConflictException) — pas de saut d'étape.
 * - `creerAvenant` pose la proratisation simple (le calcul complet de cotisation
 *   viendra avec le module billing/).
 *
 * Défense en profondeur : vérification org + rôle (roleChain hérité) EN PLUS des
 * policies RLS Postgres (`profil_a_role`, prisma/sql/005).
 */
@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly dependances: DependancesService,
  ) {}

  // --- Polices ---------------------------------------------------------

  async creerDevis(user: AuthenticatedUser, dto: CreateDevisDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

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
    if (souscripteur.statut === 'ARCHIVE') {
      throw new ConflictException(
        `La société cliente « ${souscripteur.nom} » est archivée : aucune nouvelle police. Désarchivez-la d'abord.`,
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
    if (produit.statut !== 'PUBLIE') {
      throw new BadRequestException(
        `Une police ne peut référencer qu'un produit PUBLIE (produit « ${produit.nom} » v${produit.version} : statut ${produit.statut}).`,
      );
    }

    const id = await this.prisma.$transaction(async (tx) => {
      const police = await tx.police.create({
        data: {
          organisationId: ctx.organisationId,
          souscripteurId: dto.souscripteurId,
          produitId: dto.produitId,
          statut: 'DEVIS',
          dateDebut: dto.dateDebut ? new Date(dto.dateDebut) : null,
          dateFin: dto.dateFin ? new Date(dto.dateFin) : null,
        },
      });
      await this.audit(tx, ctx.userId, 'CREATION_DEVIS', police.id, {
        souscripteurId: dto.souscripteurId,
        produitId: dto.produitId,
        numeroPolice: police.numeroPolice,
      });
      return police.id;
    });

    return this.chargerPolice(ctx, id);
  }

  async souscrire(user: AuthenticatedUser, id: string, dto: SouscrireDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const police = await this.assertPoliceDansPerimetre(ctx.organisationId, id);

    // le produit doit (encore) être PUBLIE
    const produit = await this.prisma.produit.findUnique({
      where: { id: police.produitId },
    });
    if (!produit || produit.statut !== 'PUBLIE') {
      throw new BadRequestException(
        `Souscription impossible : le produit référencé n'est pas PUBLIE (statut ${produit?.statut ?? 'introuvable'}).`,
      );
    }

    // chemin DEVIS → EN_SOUSCRIPTION → ACTIVE, chaque étape validée par la machine
    let statut = police.statut as StatutPolice;
    if (statut === 'DEVIS') {
      this.assertTransition(statut, 'EN_SOUSCRIPTION');
      statut = 'EN_SOUSCRIPTION';
    }
    if (statut === 'EN_SOUSCRIPTION') {
      this.assertTransition(statut, 'ACTIVE');
      statut = 'ACTIVE';
    } else {
      throw new ConflictException(
        `Souscription impossible depuis le statut ${police.statut}.`,
      );
    }

    const dateDebut = dto.dateDebut
      ? new Date(dto.dateDebut)
      : (police.dateDebut ?? this.aujourdhui());
    const dateFin = dto.dateFin
      ? new Date(dto.dateFin)
      : (police.dateFin ?? this.plusUnAn(dateDebut));
    if (dateFin <= dateDebut) {
      throw new BadRequestException('date_fin doit être postérieure à date_debut.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.police.update({
        where: { id },
        data: { statut: 'ACTIVE', dateDebut, dateFin },
      });
      await this.audit(tx, ctx.userId, 'SOUSCRIPTION_POLICE', id, {
        de: police.statut,
        vers: 'ACTIVE',
        dateDebut: dateDebut.toISOString().slice(0, 10),
        dateFin: dateFin.toISOString().slice(0, 10),
      });
    });

    return this.chargerPolice(ctx, id);
  }

  async changerStatut(
    user: AuthenticatedUser,
    id: string,
    nouveauStatut: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const police = await this.assertPoliceDansPerimetre(ctx.organisationId, id);

    this.assertTransition(police.statut as StatutPolice, nouveauStatut);

    const data: Prisma.PoliceUncheckedUpdateInput = { statut: nouveauStatut };
    if (
      (nouveauStatut === 'RESILIEE' || nouveauStatut === 'NON_RENOUVELEE') &&
      !police.dateFin
    ) {
      data.dateFin = this.aujourdhui();
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.police.update({ where: { id }, data });
      await this.audit(tx, ctx.userId, 'CHANGEMENT_STATUT_POLICE', id, {
        de: police.statut,
        vers: nouveauStatut,
      });
    });

    return this.chargerPolice(ctx, id);
  }

  async listerPolices(
    user: AuthenticatedUser,
    filtres: { statut?: string; souscripteurId?: string },
  ) {
    const ctx = await this.contexteAppelant(user);
    return this.prisma.police.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...this.filtreSouscripteur(ctx, filtres.souscripteurId),
        ...(filtres.statut ? { statut: filtres.statut } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        produit: { select: { nom: true, version: true, statut: true } },
        souscripteur: { select: { nom: true, type: true } },
        _count: { select: { avenants: { where: { deletedAt: null } } } },
      },
    });
  }

  async obtenirPolice(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    return this.chargerPolice(ctx, id);
  }

  /**
   * Actions réellement disponibles sur la police depuis son statut courant.
   * Source unique de vérité : `TRANSITIONS_POLICE` (+ le raccourci `souscrire`).
   * Le frontend rend `actions[]` sans redéfinir la machine à états.
   */
  async actionsDisponibles(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    const police = await this.chargerPolice(ctx, id);
    const statut = police.statut as StatutPolice;
    const brutes = TRANSITIONS_POLICE[statut] ?? [];
    const actions: ActionPolice[] = [];

    // Raccourci d'onboarding : DEVIS/EN_SOUSCRIPTION → ACTIVE en un geste (avec dates).
    if (statut === 'DEVIS' || statut === 'EN_SOUSCRIPTION') {
      actions.push({
        cle: 'souscrire',
        libelle:
          statut === 'DEVIS' ? 'Souscrire la police' : 'Activer la police',
        endpoint: 'souscrire',
        avecDates: true,
      });
    }

    for (const cible of brutes) {
      // EN_SOUSCRIPTION et ACTIVE (depuis EN_SOUSCRIPTION) sont couverts par « souscrire ».
      if (cible === 'EN_SOUSCRIPTION') continue;
      if (cible === 'ACTIVE' && statut !== 'SUSPENDUE') continue;
      actions.push({
        cle: cible,
        libelle: LIBELLE_TRANSITION[cible] ?? cible,
        endpoint: 'statut',
        statutCible: cible,
        danger: cible === 'RESILIEE' || cible === 'NON_RENOUVELEE',
      });
    }

    return { statut, transitions: brutes, actions };
  }

  // --- Avenants ------------------------------------------------------

  /** Aperçu de proratisation avant confirmation — ne persiste rien. */
  async simulerAvenant(
    user: AuthenticatedUser,
    policeId: string,
    dto: SimulerAvenantDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const police = await this.assertPoliceDansPerimetre(
      ctx.organisationId,
      policeId,
    );
    if (police.statut !== 'ACTIVE') {
      throw new ConflictException(
        `Un avenant ne peut porter que sur une police ACTIVE (statut actuel : ${police.statut}).`,
      );
    }
    const dateEffet = new Date(dto.dateEffet);
    this.assertDateEffetDansPeriode(police, dateEffet);
    const calcul = this.calculerImpact(police, dateEffet, dto);
    return {
      type: dto.type,
      dateEffet: dto.dateEffet.slice(0, 10),
      periode: {
        dateDebut: police.dateDebut?.toISOString().slice(0, 10) ?? null,
        dateFin: police.dateFin?.toISOString().slice(0, 10) ?? null,
      },
      joursTotal: calcul.joursTotal,
      joursRestants: calcul.joursRestants,
      proratisationAppliquee: calcul.proratisationAppliquee,
      impactCotisation: calcul.impact ? calcul.impact.toString() : null,
    };
  }

  async creerAvenant(
    user: AuthenticatedUser,
    policeId: string,
    dto: CreateAvenantDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const police = await this.assertPoliceDansPerimetre(
      ctx.organisationId,
      policeId,
    );
    if (police.statut !== 'ACTIVE') {
      throw new ConflictException(
        `Un avenant ne peut porter que sur une police ACTIVE (statut actuel : ${police.statut}).`,
      );
    }

    const dateEffet = new Date(dto.dateEffet);
    this.assertDateEffetDansPeriode(police, dateEffet);

    const { impact, proratisationAppliquee } = this.calculerImpact(
      police,
      dateEffet,
      dto,
    );

    return this.prisma.$transaction(async (tx) => {
      const avenant = await tx.avenant.create({
        data: {
          policeId,
          type: dto.type,
          dateEffet,
          creePar: ctx.userId,
          proratisationAppliquee,
          impactCotisation: impact ? impact.toString() : null,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CREATION_AVENANT',
        policeId,
        {
          avenantId: avenant.id,
          type: dto.type,
          dateEffet: dto.dateEffet.slice(0, 10),
          proratisationAppliquee,
          impactCotisation: impact ? impact.toString() : null,
        },
        'avenants',
      );
      return avenant;
    });
  }

  async listerAvenants(user: AuthenticatedUser, policeId: string) {
    const ctx = await this.contexteAppelant(user);
    await this.chargerPolice(ctx, policeId); // vérifie la visibilité
    return this.prisma.avenant.findMany({
      where: { policeId, deletedAt: null },
      orderBy: { dateCreation: 'desc' },
    });
  }

  async appliquerAvenant(
    user: AuthenticatedUser,
    policeId: string,
    avenantId: string,
  ) {
    return this.changerStatutAvenant(
      user,
      policeId,
      avenantId,
      'APPLIQUE',
      ['BROUILLON'],
      'APPLICATION_AVENANT',
    );
  }

  /**
   * Annule un avenant APPLIQUE (motif OBLIGATOIRE) — jamais de suppression. Décision (ADR-007,
   * lot 5) : appliquer un avenant ne modifie ni la police, ni les adhérents, ni les cotisations
   * (statut seulement ; `impact_cotisation` est indicatif), donc l'annuler n'a AUCUN effet sur la
   * police ni sur les cotisations déjà calculées : aucun recalcul, aucune compensation. L'audit
   * garde le motif, l'auteur, l'impact et l'état des cotisations de la police à cet instant.
   */
  async annulerAvenant(
    user: AuthenticatedUser,
    policeId: string,
    avenantId: string,
    motif: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertPoliceDansPerimetre(ctx.organisationId, policeId);
    const avenant = await this.avenantDeLaPolice(policeId, avenantId);
    await this.dependances.assertPossible(user, 'avenant', avenantId, 'archiver');
    if (!motif || motif.trim().length < 5) {
      throw new BadRequestException("Le motif d'annulation est obligatoire (5 caractères minimum).");
    }

    return this.prisma.$transaction(async (tx) => {
      const maj = await tx.avenant.update({
        where: { id: avenantId },
        data: { statut: 'ANNULE', motifAnnulation: motif.trim(), annuleLe: new Date(), annulePar: ctx.userId },
      });
      const cot = await tx.cotisation.aggregate({
        where: { policeId, deletedAt: null, statut: { not: 'ANNULEE' } },
        _count: true,
        _sum: { montantDu: true },
      });
      await this.audit(
        tx,
        ctx.userId,
        'ANNULATION_AVENANT',
        policeId,
        {
          avenantId,
          type: avenant.type,
          dateEffet: avenant.dateEffet.toISOString().slice(0, 10),
          motif: motif.trim(),
          annulePar: ctx.userId,
          impactCotisation: avenant.impactCotisation ? avenant.impactCotisation.toString() : null,
          cotisationsPolice: { nombre: cot._count, montantDuTotal: (cot._sum.montantDu ?? 0).toString() },
          effetSurCotisations: 'aucun (recalcul non applicable : un avenant appliqué ne modifie pas les cotisations)',
        },
        'avenants',
      );
      return maj;
    });
  }

  private async avenantDeLaPolice(policeId: string, avenantId: string) {
    const avenant = await this.prisma.avenant.findFirst({ where: { id: avenantId, policeId, deletedAt: null } });
    if (!avenant) throw new NotFoundException('Avenant introuvable.');
    return avenant;
  }

  /** Modification d'un avenant en BROUILLON : type et date d'effet, impact recalculé. */
  async modifierAvenant(user: AuthenticatedUser, policeId: string, avenantId: string, dto: UpdateAvenantDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const police = await this.assertPoliceDansPerimetre(ctx.organisationId, policeId);
    const avant = await this.avenantDeLaPolice(policeId, avenantId);
    await this.dependances.assertPossible(user, 'avenant', avenantId, 'modifier');

    const dateEffet = dto.dateEffet ? new Date(dto.dateEffet) : avant.dateEffet;
    this.assertDateEffetDansPeriode(police, dateEffet);
    const recalcule = dto.tarifMensuelFormule !== undefined || dto.impactCotisation !== undefined;
    const calcul = recalcule ? this.calculerImpact(police, dateEffet, dto) : null;

    return this.prisma.$transaction(async (tx) => {
      const maj = await tx.avenant.update({
        where: { id: avenantId },
        data: {
          ...(dto.type ? { type: dto.type } : {}),
          dateEffet,
          ...(calcul
            ? { proratisationAppliquee: calcul.proratisationAppliquee, impactCotisation: calcul.impact ? calcul.impact.toString() : null }
            : {}),
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'MODIFICATION_AVENANT',
        policeId,
        { avenantId, avant: { type: avant.type, dateEffet: avant.dateEffet.toISOString().slice(0, 10) }, apres: { type: maj.type, dateEffet: dateEffet.toISOString().slice(0, 10) } },
        'avenants',
      );
      return maj;
    });
  }

  /** Suppression (logique) d'un avenant en BROUILLON uniquement. */
  async supprimerAvenant(user: AuthenticatedUser, policeId: string, avenantId: string): Promise<void> {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertPoliceDansPerimetre(ctx.organisationId, policeId);
    const avenant = await this.avenantDeLaPolice(policeId, avenantId);
    await this.dependances.assertPossible(user, 'avenant', avenantId, 'supprimer');
    await this.prisma.$transaction(async (tx) => {
      await tx.avenant.update({ where: { id: avenantId }, data: { deletedAt: new Date() } });
      await this.audit(tx, ctx.userId, 'SUPPRESSION_AVENANT', policeId, { avenantId, type: avenant.type }, 'avenants');
    });
  }

  // --- Polices : modifier, supprimer, dupliquer en devis (ADR-007, lot 5) -----------------

  /**
   * Fait évoluer une police ACTIVE vers une autre version PUBLIÉE de formule. Les garanties d'une version publiée ne se modifient
   * jamais (les soins déjà traités gardent leurs règles) : on crée une nouvelle version (brouillon copié de la précédente), on met à jour
   * ses garanties, on la publie, puis on y rattache les polices par un avenant « changement de formule » appliqué et daté.
   */
  async changerFormule(user: AuthenticatedUser, policeId: string, dto: ChangerFormulePoliceDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const police = await this.assertPoliceDansPerimetre(ctx.organisationId, policeId);
    if (police.statut !== 'ACTIVE') {
      throw new ConflictException(`Seule une police ACTIVE peut changer de formule (statut actuel : ${police.statut}).`);
    }
    const produit = await this.produitPublieCible(ctx.organisationId, dto.produitId);
    if (produit.id === police.produitId) {
      throw new ConflictException('La police est déjà rattachée à cette version de formule.');
    }
    const dateEffet = dto.dateEffet ? new Date(dto.dateEffet) : new Date();
    this.assertDateEffetDansPeriode(police, dateEffet);

    const avenantId = await this.prisma.$transaction(async (tx) => {
      const avenant = await this.appliquerChangementFormule(tx, ctx.userId, police, produit, dateEffet);
      return avenant.id;
    });
    return { policeId, avenantId, produit: { id: produit.id, nom: produit.nom, version: produit.version } };
  }

  /** Toutes les polices ACTIVES des versions antérieures de la même formule passent à la version publiée choisie. */
  async changerFormuleEnMasse(user: AuthenticatedUser, dto: ChangerFormuleMasseDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const cible = await this.produitPublieCible(ctx.organisationId, dto.produitCibleId);
    const polices = await this.prisma.police.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        statut: 'ACTIVE',
        produit: { nom: cible.nom, version: { lt: cible.version }, deletedAt: null },
      },
    });
    const aujourdhui = new Date();
    let appliquees = 0;
    let ignorees = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const police of polices) {
        // police hors de sa période aujourd'hui : l'avenant daté du jour serait refusé → ignorée
        if ((police.dateDebut && aujourdhui < police.dateDebut) || (police.dateFin && aujourdhui > police.dateFin)) {
          ignorees += 1;
          continue;
        }
        await this.appliquerChangementFormule(tx, ctx.userId, police, cible, aujourdhui);
        appliquees += 1;
      }
    });
    return { produit: { id: cible.id, nom: cible.nom, version: cible.version }, policesMisesAJour: appliquees, ignorees };
  }

  private async produitPublieCible(organisationId: string, produitId: string) {
    const produit = await this.prisma.produit.findFirst({ where: { id: produitId, organisationId, deletedAt: null } });
    if (!produit) throw new NotFoundException('Formule introuvable.');
    if (produit.statut !== 'PUBLIE') {
      throw new BadRequestException(`Une police ne peut référencer qu'une formule PUBLIÉE (« ${produit.nom} » v${produit.version} : ${produit.statut}).`);
    }
    return produit;
  }

  private async appliquerChangementFormule(
    tx: Prisma.TransactionClient,
    userId: string,
    police: { id: string; produitId: string; numeroPolice: string | null },
    produit: { id: string; nom: string; version: number },
    dateEffet: Date,
  ) {
    const avenant = await tx.avenant.create({
      data: {
        policeId: police.id,
        type: 'CHANGEMENT_FORMULE',
        dateEffet,
        creePar: userId,
        proratisationAppliquee: false,
        impactCotisation: null,
        statut: 'APPLIQUE',
      },
    });
    await tx.police.update({ where: { id: police.id }, data: { produitId: produit.id } });
    await this.audit(
      tx,
      userId,
      'CHANGEMENT_FORMULE_POLICE',
      police.id,
      { avenantId: avenant.id, ancienProduitId: police.produitId, nouveauProduitId: produit.id, formule: `${produit.nom} v${produit.version}`, dateEffet: dateEffet.toISOString().slice(0, 10) },
    );
    return avenant;
  }

  /** Modification libre — AU STADE DU DEVIS seulement ; ensuite, un avenant. */
  async modifierPolice(user: AuthenticatedUser, id: string, dto: UpdatePoliceDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const avant = await this.assertPoliceDansPerimetre(ctx.organisationId, id);
    await this.dependances.assertPossible(user, 'police', id, 'modifier');

    if (dto.produitId) {
      const produit = await this.prisma.produit.findFirst({ where: { id: dto.produitId, organisationId: ctx.organisationId, deletedAt: null } });
      if (!produit) throw new NotFoundException('Produit introuvable.');
      if (produit.statut !== 'PUBLIE') {
        throw new BadRequestException(`Une police ne peut référencer qu'un produit PUBLIE (produit « ${produit.nom} » v${produit.version} : statut ${produit.statut}).`);
      }
    }
    const dateDebut = dto.dateDebut ? new Date(dto.dateDebut) : avant.dateDebut;
    const dateFin = dto.dateFin ? new Date(dto.dateFin) : avant.dateFin;
    if (dateDebut && dateFin && dateFin <= dateDebut) {
      throw new BadRequestException('date_fin doit être postérieure à date_debut.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.police.update({
        where: { id },
        data: { ...(dto.produitId ? { produitId: dto.produitId } : {}), dateDebut, dateFin },
      });
      await this.audit(tx, ctx.userId, 'MODIFICATION_POLICE', id, {
        produitId: { avant: avant.produitId, apres: dto.produitId ?? avant.produitId },
        dateDebut: { avant: avant.dateDebut?.toISOString().slice(0, 10) ?? null, apres: dateDebut?.toISOString().slice(0, 10) ?? null },
        dateFin: { avant: avant.dateFin?.toISOString().slice(0, 10) ?? null, apres: dateFin?.toISOString().slice(0, 10) ?? null },
      });
    });
    return this.chargerPolice(ctx, id);
  }

  /** Suppression (logique) — DEVIS sans aucun lien (adhérent, dossier, cotisation, avenant, réclamation…). */
  async supprimerPolice(user: AuthenticatedUser, id: string): Promise<void> {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const police = await this.assertPoliceDansPerimetre(ctx.organisationId, id);
    await this.dependances.assertPossible(user, 'police', id, 'supprimer');
    await this.prisma.$transaction(async (tx) => {
      await tx.police.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit(tx, ctx.userId, 'SUPPRESSION_POLICE', id, { numeroPolice: police.numeroPolice, statut: police.statut });
    });
  }

  /**
   * « Dupliquer en devis » depuis une police TERMINÉE (renouvelée, résiliée, non renouvelée —
   * statuts finaux, archivés définitivement) : nouveau DEVIS pour le même souscripteur et la même
   * formule, sans dates. Aucune donnée n'est reprise (adhérents, cotisations, avenants).
   */
  async dupliquerEnDevis(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const source = await this.assertPoliceDansPerimetre(ctx.organisationId, id);
    if (!STATUTS_POLICE_FINAUX.includes(source.statut)) {
      throw new ConflictException(`Duplication impossible : seule une police terminée (${STATUTS_POLICE_FINAUX.join(', ')}) se duplique ; celle-ci est ${source.statut}.`);
    }
    const [souscripteur, produit] = await Promise.all([
      this.prisma.souscripteur.findFirst({ where: { id: source.souscripteurId, organisationId: ctx.organisationId, deletedAt: null } }),
      this.prisma.produit.findFirst({ where: { id: source.produitId, organisationId: ctx.organisationId, deletedAt: null } }),
    ]);
    if (!souscripteur) throw new NotFoundException('Souscripteur introuvable.');
    if (souscripteur.statut === 'ARCHIVE') {
      throw new ConflictException(`Duplication impossible : la société cliente « ${souscripteur.nom} » est archivée. Désarchivez-la d'abord.`);
    }
    if (!produit || produit.statut !== 'PUBLIE') {
      throw new ConflictException(`Duplication impossible : la formule « ${produit?.nom ?? 'inconnue'} » n'est plus publiée (statut ${produit?.statut ?? 'introuvable'}). Créez un devis sur une formule publiée.`);
    }
    const id2 = await this.prisma.$transaction(async (tx) => {
      const p = await tx.police.create({
        data: { organisationId: ctx.organisationId, souscripteurId: source.souscripteurId, produitId: source.produitId, statut: 'DEVIS' },
      });
      await this.audit(tx, ctx.userId, 'DUPLICATION_POLICE', p.id, { source: id, numeroSource: source.numeroPolice, statutSource: source.statut });
      return p.id;
    });
    return this.chargerPolice(ctx, id2);
  }

  private async changerStatutAvenant(
    user: AuthenticatedUser,
    policeId: string,
    avenantId: string,
    cible: string,
    depuis: string[],
    action: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertPoliceDansPerimetre(ctx.organisationId, policeId);

    const avenant = await this.prisma.avenant.findFirst({
      where: { id: avenantId, policeId, deletedAt: null },
    });
    if (!avenant) {
      throw new NotFoundException('Avenant introuvable.');
    }
    if (!depuis.includes(avenant.statut)) {
      throw new ConflictException(
        `Transition d'avenant ${avenant.statut} → ${cible} non autorisée.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const maj = await tx.avenant.update({
        where: { id: avenantId },
        data: { statut: cible },
      });
      await this.audit(
        tx,
        ctx.userId,
        action,
        policeId,
        { avenantId, de: avenant.statut, vers: cible },
        'avenants',
      );
      return maj;
    });
  }

  // --- Autorisation / scoping --------------------------------------

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

  private assertGestion(ctx: ContexteAppelant): void {
    const autorise = ctx.roleChain.some((code) =>
      (ROLES_GESTION_POLICE as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        'Rôle insuffisant : la gestion des polices est réservée aux rôles ASSUREUR habilités (direction, exploitation, informatique).',
      );
    }
  }

  private assertTransition(de: StatutPolice, vers: string): void {
    if (!(STATUTS_POLICE as readonly string[]).includes(vers)) {
      throw new BadRequestException(`Statut cible inconnu : ${vers}.`);
    }
    const possibles = TRANSITIONS_POLICE[de] ?? [];
    if (!possibles.includes(vers as StatutPolice)) {
      throw new ConflictException(
        `Transition ${de} → ${vers} non autorisée. Transitions possibles depuis ${de} : ${
          possibles.join(', ') || 'aucune'
        }.`,
      );
    }
  }

  /** Filtre de scope pour la lecture : société → uniquement ses propres polices. */
  private filtreSouscripteur(
    ctx: ContexteAppelant,
    souscripteurId?: string,
  ): Prisma.PoliceWhereInput {
    if (ctx.entite !== 'ASSUREUR') {
      return { souscripteurId: ctx.societeId ?? UUID_ZERO };
    }
    return souscripteurId ? { souscripteurId } : {};
  }

  private async assertPoliceDansPerimetre(organisationId: string, id: string) {
    const police = await this.prisma.police.findFirst({
      where: { id, organisationId, deletedAt: null },
    });
    if (!police) {
      throw new NotFoundException('Police introuvable.');
    }
    return police;
  }

  private async chargerPolice(ctx: ContexteAppelant, id: string) {
    const police = await this.prisma.police.findFirst({
      where: {
        id,
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...this.filtreSouscripteur(ctx),
      },
      include: {
        avenants: { where: { deletedAt: null }, orderBy: { dateCreation: 'desc' } },
        produit: { select: { nom: true, version: true, statut: true } },
        souscripteur: { select: { nom: true, type: true } },
      },
    });
    if (!police) {
      throw new NotFoundException('Police introuvable.');
    }
    return police;
  }

  // --- Helpers avenant --------------------------------------------

  private assertDateEffetDansPeriode(
    police: { dateDebut: Date | null; dateFin: Date | null },
    dateEffet: Date,
  ): void {
    if (police.dateDebut && police.dateFin) {
      if (dateEffet < police.dateDebut || dateEffet > police.dateFin) {
        throw new BadRequestException(
          'date_effet doit être comprise dans la période de la police.',
        );
      }
    }
  }

  /**
   * Impact sur la cotisation d'un avenant :
   *   - `tarifMensuelFormule` fourni → proratisation
   *     `tarif × jours_restants / jours_total`, `proratisation_appliquee = true` ;
   *   - sinon `impactCotisation` fourni → repris tel quel ;
   *   - sinon `null`.
   */
  private calculerImpact(
    police: { dateDebut: Date | null; dateFin: Date | null },
    dateEffet: Date,
    dto: { tarifMensuelFormule?: number; impactCotisation?: number },
  ): {
    impact: Decimal | null;
    proratisationAppliquee: boolean;
    joursTotal: number | null;
    joursRestants: number | null;
  } {
    if (dto.tarifMensuelFormule !== undefined) {
      if (!police.dateDebut || !police.dateFin) {
        throw new BadRequestException(
          "Proratisation impossible : la police n'a pas de période définie.",
        );
      }
      const joursTotal = this.joursEntre(police.dateDebut, police.dateFin);
      const joursRestants = this.joursEntre(dateEffet, police.dateFin);
      const impact = new Decimal(dto.tarifMensuelFormule)
        .mul(joursRestants)
        .div(joursTotal)
        .toDecimalPlaces(2);
      return {
        impact,
        proratisationAppliquee: true,
        joursTotal,
        joursRestants,
      };
    }
    if (dto.impactCotisation !== undefined) {
      return {
        impact: new Decimal(dto.impactCotisation).toDecimalPlaces(2),
        proratisationAppliquee: false,
        joursTotal: null,
        joursRestants: null,
      };
    }
    return {
      impact: null,
      proratisationAppliquee: false,
      joursTotal: null,
      joursRestants: null,
    };
  }

  // --- Helpers dates -----------------------------------------------

  private aujourdhui(): Date {
    const d = new Date();
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
  }

  private plusUnAn(d: Date): Date {
    return new Date(
      Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()),
    );
  }

  private joursEntre(a: Date, b: Date): number {
    return Math.round((b.getTime() - a.getTime()) / MS_PAR_JOUR);
  }

  /** Écriture d'audit — toujours via la fonction Postgres `log_audit()` (v9 §1.6). */
  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
    tableCible = 'polices',
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
