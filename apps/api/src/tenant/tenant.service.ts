import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMembreComiteDto } from './dto/create-membre-comite.dto';
import {
  CreateSouscripteurDto,
  MembreComiteInlineDto,
} from './dto/create-souscripteur.dto';
import { UpdateSouscripteurDto } from './dto/update-souscripteur.dto';
import { ContexteAppelant, ROLES_GESTION_SOUSCRIPTEUR } from './tenant.types';
import { DependancesService } from '../dependances/dependances.service';

/** Client Prisma ou client transactionnel. */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * TenantService — CRUD des souscripteurs (sociétés affiliées et individuels) et
 * de leur comité de gestion, STRICTEMENT scopé par `organisation_id`.
 *
 * Défense en profondeur (v9 règles transverses) : ce service applique ses
 * propres vérifications (organisation de l'appelant + rôle) EN PLUS des policies
 * RLS Postgres — le chemin NestJS passe par le rôle `postgres` du pooler et
 * contourne la RLS, donc l'enforcement applicatif est ici obligatoire.
 */
@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly dependances: DependancesService,
  ) {}

  // --- Souscripteurs -------------------------------------------------------

  async creer(user: AuthenticatedUser, dto: CreateSouscripteurDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    this.validerCoherenceSegments(dto);

    const membres = dto.membresComite ?? [];
    if (membres.length > 0) {
      await this.verifierProfilsMembres(
        ctx.organisationId,
        membres.map((m) => m.userId),
      );
    }

    const id = await this.prisma.$transaction((tx) =>
      this.creerDansTransaction(tx, ctx, dto, membres),
    );

    return this.chargerSouscripteur(this.prisma, ctx.organisationId, id);
  }

  async lister(user: AuthenticatedUser, filtres: { type?: string }) {
    const ctx = await this.contexteAppelant(user);
    this.assertLectureAssureur(ctx);

    return this.prisma.souscripteur.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(filtres.type ? { type: filtres.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async obtenir(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertLectureAssureur(ctx);
    return this.chargerSouscripteur(this.prisma, ctx.organisationId, id);
  }

  async modifier(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateSouscripteurDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertSouscripteurDansPerimetre(ctx.organisationId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.souscripteur.update({ where: { id }, data: { ...dto } });
      await this.audit(tx, ctx.userId, 'MODIFICATION_SOUSCRIPTEUR', id, {
        champs: Object.keys(dto),
      });
    });

    return this.chargerSouscripteur(this.prisma, ctx.organisationId, id);
  }

  async supprimer(user: AuthenticatedUser, id: string): Promise<void> {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertSouscripteurDansPerimetre(ctx.organisationId, id);

    // ADR-007 : aucune suppression d'un élément encore lié (409 + raison, refus tracé)
    await this.dependances.assertPossible(user, 'souscripteur', id, 'supprimer');

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.souscripteur.update({
        where: { id },
        data: { deletedAt: now },
      });
      // clôture des mandats en cours de son comité
      await tx.membreComiteGestion.updateMany({
        where: { souscripteurId: id, deletedAt: null },
        data: { deletedAt: now, dateFinMandat: now },
      });
      await this.audit(tx, ctx.userId, 'SUPPRESSION_SOUSCRIPTEUR', id, null);
    });
  }

  // --- Comité de gestion (collectivités) --------------------------------

  async listerMembresComite(user: AuthenticatedUser, souscripteurId: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertLectureAssureur(ctx);
    await this.assertSouscripteurDansPerimetre(ctx.organisationId, souscripteurId);

    return this.prisma.membreComiteGestion.findMany({
      where: { souscripteurId, deletedAt: null },
      orderBy: { dateDebutMandat: 'asc' },
    });
  }

  async ajouterMembreComite(
    user: AuthenticatedUser,
    souscripteurId: string,
    dto: CreateMembreComiteDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

    const souscripteur = await this.assertSouscripteurDansPerimetre(
      ctx.organisationId,
      souscripteurId,
    );
    if (souscripteur.type !== 'COLLECTIVITE') {
      throw new BadRequestException(
        'Un comité de gestion ne concerne que les souscripteurs de type COLLECTIVITE.',
      );
    }
    await this.verifierProfilsMembres(ctx.organisationId, [dto.userId]);

    return this.prisma.$transaction(async (tx) => {
      const membre = await tx.membreComiteGestion.create({
        data: {
          souscripteurId,
          userId: dto.userId,
          fonction: dto.fonction,
          ...this.datesMandat(dto),
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'AJOUT_MEMBRE_COMITE',
        souscripteurId,
        { membreId: membre.id, userId: dto.userId, fonction: dto.fonction },
        'membres_comite_gestion',
      );
      return membre;
    });
  }

  async retirerMembreComite(
    user: AuthenticatedUser,
    souscripteurId: string,
    membreId: string,
  ): Promise<void> {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertSouscripteurDansPerimetre(ctx.organisationId, souscripteurId);

    const membre = await this.prisma.membreComiteGestion.findFirst({
      where: { id: membreId, souscripteurId, deletedAt: null },
    });
    if (!membre) {
      throw new NotFoundException('Membre de comité introuvable.');
    }

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.membreComiteGestion.update({
        where: { id: membreId },
        data: { deletedAt: now, dateFinMandat: membre.dateFinMandat ?? now },
      });
      await this.audit(
        tx,
        ctx.userId,
        'RETRAIT_MEMBRE_COMITE',
        souscripteurId,
        { membreId },
        'membres_comite_gestion',
      );
    });
  }

  // --- Autorisation -----------------------------------------------------

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
      roleChain: permissions?.roleChain ?? [],
    };
  }

  private assertLectureAssureur(ctx: ContexteAppelant): void {
    if (ctx.entite !== 'ASSUREUR') {
      throw new ForbiddenException(
        "Accès réservé aux profils de l'assureur.",
      );
    }
  }

  private assertGestion(ctx: ContexteAppelant): void {
    this.assertLectureAssureur(ctx);
    const autorise = ctx.roleChain.some((code) =>
      (ROLES_GESTION_SOUSCRIPTEUR as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        'Rôle insuffisant pour gérer les souscripteurs (direction, exploitation ou informatique requis).',
      );
    }
  }

  // --- Helpers ----------------------------------------------------------

  private validerCoherenceSegments(dto: CreateSouscripteurDto): void {
    if (dto.membresComite?.length && dto.type !== 'COLLECTIVITE') {
      throw new BadRequestException(
        'membresComite n’est autorisé que pour un souscripteur de type COLLECTIVITE.',
      );
    }
  }

  private async verifierProfilsMembres(
    organisationId: string,
    userIds: string[],
  ): Promise<void> {
    const uniques = [...new Set(userIds)];
    const profils = await this.prisma.profil.findMany({
      where: { id: { in: uniques }, deletedAt: null },
      select: { id: true, organisationId: true },
    });
    const parId = new Map(profils.map((p) => [p.id, p]));

    const invalides = uniques.filter((id) => {
      const p = parId.get(id);
      return !p || p.organisationId !== organisationId;
    });
    if (invalides.length > 0) {
      throw new BadRequestException(
        `Profils de comité invalides ou hors organisation : ${invalides.join(', ')}`,
      );
    }
  }

  private async creerDansTransaction(
    tx: Prisma.TransactionClient,
    ctx: ContexteAppelant,
    dto: CreateSouscripteurDto,
    membres: MembreComiteInlineDto[],
  ): Promise<string> {
    const souscripteur = await tx.souscripteur.create({
      data: {
        organisationId: ctx.organisationId,
        type: dto.type,
        nom: dto.nom,
        secteurActivite: dto.secteurActivite ?? null,
        effectifDeclare: dto.effectifDeclare ?? null,
        typeCollectivite: dto.typeCollectivite ?? null,
        organeGouvernance: dto.organeGouvernance ?? null,
        subventionExterne: dto.subventionExterne ?? false,
        bailleurSubvention: dto.bailleurSubvention ?? null,
        numeroPieceIdentite: dto.numeroPieceIdentite ?? null,
        questionnaireMedicalId: dto.questionnaireMedicalId ?? null,
      },
    });

    for (const m of membres) {
      await tx.membreComiteGestion.create({
        data: {
          souscripteurId: souscripteur.id,
          userId: m.userId,
          fonction: m.fonction,
          ...this.datesMandat(m),
        },
      });
    }

    await this.audit(
      tx,
      ctx.userId,
      'CREATION_SOUSCRIPTEUR',
      souscripteur.id,
      { type: dto.type, nom: dto.nom, membresComite: membres.length },
    );

    return souscripteur.id;
  }

  private datesMandat(m: { dateDebutMandat?: string; dateFinMandat?: string }) {
    return {
      ...(m.dateDebutMandat
        ? { dateDebutMandat: new Date(m.dateDebutMandat) }
        : {}),
      ...(m.dateFinMandat ? { dateFinMandat: new Date(m.dateFinMandat) } : {}),
    };
  }

  private async chargerSouscripteur(
    db: Db,
    organisationId: string,
    id: string,
  ) {
    const souscripteur = await db.souscripteur.findFirst({
      where: { id, organisationId, deletedAt: null },
      include: {
        membresComite: {
          where: { deletedAt: null },
          orderBy: { dateDebutMandat: 'asc' },
        },
      },
    });
    if (!souscripteur) {
      throw new NotFoundException('Souscripteur introuvable.');
    }
    return souscripteur;
  }

  private async assertSouscripteurDansPerimetre(
    organisationId: string,
    id: string,
  ) {
    const souscripteur = await this.prisma.souscripteur.findFirst({
      where: { id, organisationId, deletedAt: null },
    });
    if (!souscripteur) {
      // 404 plutôt que 403 : ne pas révéler l'existence d'un souscripteur
      // appartenant à une autre organisation.
      throw new NotFoundException('Souscripteur introuvable.');
    }
    return souscripteur;
  }

  /** Écriture d'audit — toujours via la fonction Postgres `log_audit()` (v9 §1.6). */
  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
    tableCible = 'souscripteurs',
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
