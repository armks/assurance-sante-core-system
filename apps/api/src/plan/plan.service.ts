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
import { CreateGarantieDto, UpdateGarantieDto } from './dto/garantie.dto';
import { CreateProduitDto, UpdateProduitDto } from './dto/produit.dto';
import { ContexteAppelant, ROLES_GESTION_PLAN } from './plan.types';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * PlanService — configuration des produits d'assurance VERSIONNÉS et de leurs
 * garanties (v9 phase 2.1 / v3 §2).
 *
 * Règle centrale : une version PUBLIE est IMMUABLE. Toute évolution passe par
 * `creerNouvelleVersion` (nouveau BROUILLON, version + 1). Jamais de modification
 * d'un produit / d'une garantie déjà publié.
 *
 * Défense en profondeur : ce service vérifie l'organisation de l'appelant + son
 * rôle (roleChain hérité) EN PLUS des policies RLS Postgres (`profil_a_role`,
 * même pattern que le PROMPT 5) — le chemin NestJS passe par le rôle `postgres`
 * du pooler et contourne la RLS.
 */
@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  // --- Produits ----------------------------------------------------------

  async creerProduit(user: AuthenticatedUser, dto: CreateProduitDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

    const existeActif = await this.prisma.produit.findFirst({
      where: { organisationId: ctx.organisationId, nom: dto.nom, deletedAt: null },
    });
    if (existeActif) {
      throw new ConflictException(
        `Un produit nommé « ${dto.nom} » existe déjà. Utilisez /nouvelle-version pour le faire évoluer.`,
      );
    }

    const version = await this.prochaineVersion(ctx.organisationId, dto.nom);

    const id = await this.prisma.$transaction(async (tx) => {
      const produit = await tx.produit.create({
        data: {
          organisationId: ctx.organisationId,
          nom: dto.nom,
          version,
          statut: 'BROUILLON',
        },
      });
      for (const g of dto.garanties ?? []) {
        await tx.garantie.create({
          data: this.garantieCreateData(produit.id, g),
        });
      }
      await this.audit(tx, ctx.userId, 'CREATION_PRODUIT', produit.id, {
        nom: dto.nom,
        version,
        garanties: dto.garanties?.length ?? 0,
      });
      return produit.id;
    });

    return this.chargerProduit(ctx.organisationId, id);
  }

  async listerProduits(
    user: AuthenticatedUser,
    filtres: { statut?: string; nom?: string },
  ) {
    const ctx = await this.contexteAppelant(user);
    return this.prisma.produit.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(filtres.statut ? { statut: filtres.statut } : {}),
        ...(filtres.nom ? { nom: filtres.nom } : {}),
      },
      orderBy: [{ nom: 'asc' }, { version: 'desc' }],
      include: {
        _count: { select: { garanties: { where: { deletedAt: null } } } },
      },
    });
  }

  async obtenirProduit(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    return this.chargerProduit(ctx.organisationId, id);
  }

  async modifierProduit(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateProduitDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const produit = await this.assertProduitDansPerimetre(ctx.organisationId, id);
    this.assertBrouillon(produit, 'Modification du produit');

    if (dto.nom && dto.nom !== produit.nom) {
      const collision = await this.prisma.produit.findFirst({
        where: {
          organisationId: ctx.organisationId,
          nom: dto.nom,
          deletedAt: null,
        },
      });
      if (collision) {
        throw new ConflictException(`Un produit « ${dto.nom} » existe déjà.`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.produit.update({ where: { id }, data: { ...dto } });
      await this.audit(tx, ctx.userId, 'MODIFICATION_PRODUIT', id, {
        champs: Object.keys(dto),
      });
    });
    return this.chargerProduit(ctx.organisationId, id);
  }

  async publier(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const produit = await this.assertProduitDansPerimetre(ctx.organisationId, id);
    if (produit.statut !== 'BROUILLON') {
      throw new ConflictException(
        `Seul un produit BROUILLON peut être publié (statut actuel : ${produit.statut}).`,
      );
    }

    const nbGaranties = await this.prisma.garantie.count({
      where: { produitId: id, deletedAt: null },
    });
    if (nbGaranties === 0) {
      throw new BadRequestException(
        'Impossible de publier un produit sans aucune garantie.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.produit.update({
        where: { id },
        data: { statut: 'PUBLIE', datePublication: new Date() },
      });
      await this.audit(tx, ctx.userId, 'PUBLICATION_PRODUIT', id, {
        version: produit.version,
        garanties: nbGaranties,
      });
    });
    return this.chargerProduit(ctx.organisationId, id);
  }

  async archiver(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const produit = await this.assertProduitDansPerimetre(ctx.organisationId, id);
    if (produit.statut === 'ARCHIVE') {
      throw new ConflictException('Le produit est déjà archivé.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.produit.update({ where: { id }, data: { statut: 'ARCHIVE' } });
      await this.audit(tx, ctx.userId, 'ARCHIVAGE_PRODUIT', id, {
        statutPrecedent: produit.statut,
      });
    });
    return this.chargerProduit(ctx.organisationId, id);
  }

  /** Évolution d'un produit : clone (produit + garanties) en un BROUILLON version+1. */
  async creerNouvelleVersion(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const source = await this.assertProduitDansPerimetre(ctx.organisationId, id);

    const brouillonExistant = await this.prisma.produit.findFirst({
      where: {
        organisationId: ctx.organisationId,
        nom: source.nom,
        statut: 'BROUILLON',
        deletedAt: null,
      },
    });
    if (brouillonExistant) {
      throw new ConflictException(
        `Une version BROUILLON du produit « ${source.nom} » existe déjà (v${brouillonExistant.version}).`,
      );
    }

    const version = await this.prochaineVersion(ctx.organisationId, source.nom);
    const garantiesSource = await this.prisma.garantie.findMany({
      where: { produitId: id, deletedAt: null },
    });

    const nouveauId = await this.prisma.$transaction(async (tx) => {
      const nouveau = await tx.produit.create({
        data: {
          organisationId: ctx.organisationId,
          nom: source.nom,
          version,
          statut: 'BROUILLON',
        },
      });
      for (const g of garantiesSource) {
        await tx.garantie.create({
          data: {
            produitId: nouveau.id,
            categorieActe: g.categorieActe,
            tauxCouverture: g.tauxCouverture,
            plafondParActe: g.plafondParActe,
            plafondAnnuel: g.plafondAnnuel,
            franchise: g.franchise,
            ticketModerateur: g.ticketModerateur,
            delaiCarenceJours: g.delaiCarenceJours,
            reseauSoins: g.reseauSoins,
            exclusions: g.exclusions,
          },
        });
      }
      await this.audit(tx, ctx.userId, 'NOUVELLE_VERSION_PRODUIT', nouveau.id, {
        nom: source.nom,
        versionSource: source.version,
        version,
        garanties: garantiesSource.length,
      });
      return nouveau.id;
    });

    return this.chargerProduit(ctx.organisationId, nouveauId);
  }

  // --- Garanties -------------------------------------------------------

  async ajouterGarantie(
    user: AuthenticatedUser,
    produitId: string,
    dto: CreateGarantieDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const produit = await this.assertProduitDansPerimetre(
      ctx.organisationId,
      produitId,
    );
    this.assertBrouillon(produit, 'Ajout de garantie');

    return this.prisma.$transaction(async (tx) => {
      const garantie = await tx.garantie.create({
        data: this.garantieCreateData(produitId, dto),
      });
      await this.audit(
        tx,
        ctx.userId,
        'AJOUT_GARANTIE',
        produitId,
        { garantieId: garantie.id, categorie: dto.categorieActe },
        'garanties',
      );
      return garantie;
    });
  }

  async modifierGarantie(
    user: AuthenticatedUser,
    produitId: string,
    garantieId: string,
    dto: UpdateGarantieDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const produit = await this.assertProduitDansPerimetre(
      ctx.organisationId,
      produitId,
    );
    // cas critique : une garantie d'un produit publié est immuable
    this.assertBrouillon(produit, 'Modification de garantie');

    const garantie = await this.prisma.garantie.findFirst({
      where: { id: garantieId, produitId, deletedAt: null },
    });
    if (!garantie) {
      throw new NotFoundException('Garantie introuvable.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.garantie.update({
        where: { id: garantieId },
        data: this.garantieUpdateData(dto),
      });
      await this.audit(
        tx,
        ctx.userId,
        'MODIFICATION_GARANTIE',
        produitId,
        { garantieId, champs: Object.keys(dto) },
        'garanties',
      );
    });
    return this.prisma.garantie.findUnique({ where: { id: garantieId } });
  }

  async supprimerGarantie(
    user: AuthenticatedUser,
    produitId: string,
    garantieId: string,
  ): Promise<void> {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const produit = await this.assertProduitDansPerimetre(
      ctx.organisationId,
      produitId,
    );
    this.assertBrouillon(produit, 'Suppression de garantie');

    const garantie = await this.prisma.garantie.findFirst({
      where: { id: garantieId, produitId, deletedAt: null },
    });
    if (!garantie) {
      throw new NotFoundException('Garantie introuvable.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.garantie.update({
        where: { id: garantieId },
        data: { deletedAt: new Date() },
      });
      await this.audit(
        tx,
        ctx.userId,
        'SUPPRESSION_GARANTIE',
        produitId,
        { garantieId },
        'garanties',
      );
    });
  }

  // --- Autorisation ---------------------------------------------------

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
      (ROLES_GESTION_PLAN as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        'Rôle insuffisant : la gestion des produits est réservée à ASSUREUR_DIRECTION et ASSUREUR_INFORMATIQUE.',
      );
    }
  }

  // --- Helpers ------------------------------------------------------

  private assertBrouillon(
    produit: { statut: string },
    action: string,
  ): void {
    if (produit.statut !== 'BROUILLON') {
      throw new ConflictException(
        `${action} impossible : le produit est ${produit.statut}. Une version publiée est immuable — créez une nouvelle version.`,
      );
    }
  }

  private async prochaineVersion(
    organisationId: string,
    nom: string,
  ): Promise<number> {
    // inclut les versions supprimées : la contrainte UNIQUE(org,nom,version) reste vraie
    const agg = await this.prisma.produit.aggregate({
      where: { organisationId, nom },
      _max: { version: true },
    });
    return (agg._max.version ?? 0) + 1;
  }

  private garantieCreateData(
    produitId: string,
    dto: CreateGarantieDto,
  ): Prisma.GarantieUncheckedCreateInput {
    return {
      produitId,
      categorieActe: dto.categorieActe,
      tauxCouverture: dto.tauxCouverture ?? null,
      plafondParActe: dto.plafondParActe ?? null,
      plafondAnnuel: dto.plafondAnnuel ?? null,
      franchise: dto.franchise ?? null,
      ticketModerateur: dto.ticketModerateur ?? null,
      delaiCarenceJours: dto.delaiCarenceJours ?? null,
      reseauSoins: dto.reseauSoins ?? 'TOUT_RESEAU',
      exclusions: dto.exclusions ?? [],
    };
  }

  private garantieUpdateData(
    dto: UpdateGarantieDto,
  ): Prisma.GarantieUncheckedUpdateInput {
    const d: Prisma.GarantieUncheckedUpdateInput = {};
    if (dto.categorieActe !== undefined) d.categorieActe = dto.categorieActe;
    if (dto.tauxCouverture !== undefined) d.tauxCouverture = dto.tauxCouverture;
    if (dto.plafondParActe !== undefined) d.plafondParActe = dto.plafondParActe;
    if (dto.plafondAnnuel !== undefined) d.plafondAnnuel = dto.plafondAnnuel;
    if (dto.franchise !== undefined) d.franchise = dto.franchise;
    if (dto.ticketModerateur !== undefined)
      d.ticketModerateur = dto.ticketModerateur;
    if (dto.delaiCarenceJours !== undefined)
      d.delaiCarenceJours = dto.delaiCarenceJours;
    if (dto.reseauSoins !== undefined) d.reseauSoins = dto.reseauSoins;
    if (dto.exclusions !== undefined) d.exclusions = dto.exclusions;
    return d;
  }

  private async chargerProduit(organisationId: string, id: string) {
    const produit = await this.prisma.produit.findFirst({
      where: { id, organisationId, deletedAt: null },
      include: {
        garanties: {
          where: { deletedAt: null },
          orderBy: { categorieActe: 'asc' },
        },
      },
    });
    if (!produit) {
      throw new NotFoundException('Produit introuvable.');
    }
    return produit;
  }

  private async assertProduitDansPerimetre(organisationId: string, id: string) {
    const produit = await this.prisma.produit.findFirst({
      where: { id, organisationId, deletedAt: null },
    });
    if (!produit) {
      // 404 plutôt que 403 : ne pas révéler l'existence d'un produit d'une autre organisation
      throw new NotFoundException('Produit introuvable.');
    }
    return produit;
  }

  /** Écriture d'audit — toujours via la fonction Postgres `log_audit()` (v9 §1.6). */
  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
    tableCible = 'produits',
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
