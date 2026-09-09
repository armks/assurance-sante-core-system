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
  CreateAvenantDto,
  CreateDevisDto,
  SouscrireDto,
} from './dto/policy.dto';
import {
  ContexteAppelant,
  ROLES_GESTION_POLICE,
  STATUTS_POLICE,
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
    });
  }

  async obtenirPolice(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    return this.chargerPolice(ctx, id);
  }

  // --- Avenants ------------------------------------------------------

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
    if (police.dateDebut && police.dateFin) {
      if (dateEffet < police.dateDebut || dateEffet > police.dateFin) {
        throw new BadRequestException(
          "date_effet doit être comprise dans la période de la police.",
        );
      }
    }

    let impact: Decimal | null = null;
    let proratisationAppliquee = false;

    if (dto.tarifMensuelFormule !== undefined) {
      if (!police.dateDebut || !police.dateFin) {
        throw new BadRequestException(
          'Proratisation impossible : la police n\'a pas de période définie.',
        );
      }
      const joursTotal = this.joursEntre(police.dateDebut, police.dateFin);
      const joursRestants = this.joursEntre(dateEffet, police.dateFin);
      // montant_prorata = tarif_mensuel × jours_restants / jours_total
      impact = new Decimal(dto.tarifMensuelFormule)
        .mul(joursRestants)
        .div(joursTotal)
        .toDecimalPlaces(2);
      proratisationAppliquee = true;
    } else if (dto.impactCotisation !== undefined) {
      impact = new Decimal(dto.impactCotisation).toDecimalPlaces(2);
    }

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

  async annulerAvenant(
    user: AuthenticatedUser,
    policeId: string,
    avenantId: string,
  ) {
    return this.changerStatutAvenant(
      user,
      policeId,
      avenantId,
      'ANNULE',
      ['BROUILLON', 'APPLIQUE'],
      'ANNULATION_AVENANT',
    );
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
