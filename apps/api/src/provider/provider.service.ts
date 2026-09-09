import {
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
import {
  CreateEtablissementDto,
  CreatePharmacieDto,
  RechercheGeoDto,
  UpdateEtablissementDto,
  UpdatePharmacieDto,
} from './dto/provider.dto';
import { ContexteAppelant, ROLES_GESTION_RESEAU } from './provider.types';

type Db = PrismaService | Prisma.TransactionClient;

interface PointGeo {
  latitude: number | null;
  longitude: number | null;
}

/**
 * ProviderService — réseau de soins : établissements de santé et pharmacies
 * (v9 phase 4.1, PROMPT 14).
 *
 * Écriture réservée à ASSUREUR_INFORMATIQUE (v9 §2.2). Lecture ouverte à toute
 * personne de l'organisation. Défense en profondeur : ce service vérifie
 * l'organisation + le rôle EN PLUS des policies RLS `profil_a_role`
 * (prisma/sql/009) — le chemin NestJS passe par `postgres` (pooler) et
 * contourne la RLS.
 *
 * Recherche géolocalisée : distance calculée en mémoire (formule de Haversine),
 * pas de PostGIS.
 */
@Injectable()
export class ProviderService {
  private readonly logger = new Logger(ProviderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  // --- Établissements de santé ---------------------------------------

  async creerEtablissement(
    user: AuthenticatedUser,
    dto: CreateEtablissementDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertCodeLibre('etablissementSante', dto.code);

    const id = await this.prisma.$transaction(async (tx) => {
      const e = await tx.etablissementSante.create({
        data: {
          organisationId: ctx.organisationId,
          nom: dto.nom,
          code: dto.code,
          typeEtablissement: dto.typeEtablissement,
          ...(dto.pays ? { pays: dto.pays } : {}),
          ville: dto.ville ?? null,
          commune: dto.commune ?? null,
          quartier: dto.quartier ?? null,
          adresseComplete: dto.adresseComplete ?? null,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          telephone: dto.telephone ?? null,
          telephoneUrgence: dto.telephoneUrgence ?? null,
          email: dto.email ?? null,
          ...(dto.statut ? { statut: dto.statut } : {}),
          dateConvention: dto.dateConvention
            ? new Date(dto.dateConvention)
            : null,
          dateFinConvention: dto.dateFinConvention
            ? new Date(dto.dateFinConvention)
            : null,
          gardeWeekend: dto.gardeWeekend ?? false,
          horairesGarde: (dto.horairesGarde ?? undefined) as Prisma.InputJsonValue,
          horairesSemaine: (dto.horairesSemaine ??
            undefined) as Prisma.InputJsonValue,
          tiersPayant: dto.tiersPayant ?? true,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CREATION_ETABLISSEMENT',
        e.id,
        { code: dto.code, type: dto.typeEtablissement },
        'etablissements_sante',
      );
      return e.id;
    });

    return this.chargerEtablissement(ctx.organisationId, id);
  }

  async listerEtablissements(
    user: AuthenticatedUser,
    filtres: { type?: string; statut?: string; ville?: string },
  ) {
    const ctx = await this.contexteAppelant(user);
    return this.prisma.etablissementSante.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(filtres.type ? { typeEtablissement: filtres.type } : {}),
        ...(filtres.statut ? { statut: filtres.statut } : {}),
        ...(filtres.ville
          ? { ville: { equals: filtres.ville, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { nom: 'asc' },
    });
  }

  async obtenirEtablissement(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    return this.chargerEtablissement(ctx.organisationId, id);
  }

  async modifierEtablissement(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateEtablissementDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertEtablissementDansPerimetre(ctx.organisationId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.etablissementSante.update({
        where: { id },
        data: this.lieuUpdateData(dto),
      });
      await this.audit(
        tx,
        ctx.userId,
        'MODIFICATION_ETABLISSEMENT',
        id,
        { champs: Object.keys(dto) },
        'etablissements_sante',
      );
    });
    return this.chargerEtablissement(ctx.organisationId, id);
  }

  async supprimerEtablissement(
    user: AuthenticatedUser,
    id: string,
  ): Promise<void> {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertEtablissementDansPerimetre(ctx.organisationId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.etablissementSante.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.audit(
        tx,
        ctx.userId,
        'SUPPRESSION_ETABLISSEMENT',
        id,
        null,
        'etablissements_sante',
      );
    });
  }

  // --- Pharmacies ---------------------------------------------------

  async creerPharmacie(user: AuthenticatedUser, dto: CreatePharmacieDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertCodeLibre('pharmacie', dto.code);

    const id = await this.prisma.$transaction(async (tx) => {
      const p = await tx.pharmacie.create({
        data: {
          organisationId: ctx.organisationId,
          nom: dto.nom,
          code: dto.code,
          ...(dto.pays ? { pays: dto.pays } : {}),
          ville: dto.ville ?? null,
          commune: dto.commune ?? null,
          quartier: dto.quartier ?? null,
          adresseComplete: dto.adresseComplete ?? null,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          telephone: dto.telephone ?? null,
          email: dto.email ?? null,
          ...(dto.statut ? { statut: dto.statut } : {}),
          gardeWeekend: dto.gardeWeekend ?? false,
          horairesGarde: (dto.horairesGarde ?? undefined) as Prisma.InputJsonValue,
          tiersPayant: dto.tiersPayant ?? true,
          dateConvention: dto.dateConvention
            ? new Date(dto.dateConvention)
            : null,
          dateFinConvention: dto.dateFinConvention
            ? new Date(dto.dateFinConvention)
            : null,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CREATION_PHARMACIE',
        p.id,
        { code: dto.code },
        'pharmacies',
      );
      return p.id;
    });

    return this.chargerPharmacie(ctx.organisationId, id);
  }

  async listerPharmacies(
    user: AuthenticatedUser,
    filtres: { statut?: string; ville?: string },
  ) {
    const ctx = await this.contexteAppelant(user);
    return this.prisma.pharmacie.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(filtres.statut ? { statut: filtres.statut } : {}),
        ...(filtres.ville
          ? { ville: { equals: filtres.ville, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { nom: 'asc' },
    });
  }

  async obtenirPharmacie(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    return this.chargerPharmacie(ctx.organisationId, id);
  }

  async modifierPharmacie(
    user: AuthenticatedUser,
    id: string,
    dto: UpdatePharmacieDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertPharmacieDansPerimetre(ctx.organisationId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.pharmacie.update({
        where: { id },
        data: this.lieuUpdateData(dto),
      });
      await this.audit(
        tx,
        ctx.userId,
        'MODIFICATION_PHARMACIE',
        id,
        { champs: Object.keys(dto) },
        'pharmacies',
      );
    });
    return this.chargerPharmacie(ctx.organisationId, id);
  }

  async supprimerPharmacie(user: AuthenticatedUser, id: string): Promise<void> {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertPharmacieDansPerimetre(ctx.organisationId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.pharmacie.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.audit(
        tx,
        ctx.userId,
        'SUPPRESSION_PHARMACIE',
        id,
        null,
        'pharmacies',
      );
    });
  }

  // --- Recherche géolocalisée -------------------------------------

  async rechercheGeolocalisee(user: AuthenticatedUser, dto: RechercheGeoDto) {
    const ctx = await this.contexteAppelant(user);
    const rayon = dto.rayonKm ?? 5;
    const limite = dto.limite ?? 50;
    const cible = dto.cible ?? 'TOUS';

    const resultat: {
      centre: { lat: number; lng: number };
      rayonKm: number;
      etablissements?: unknown[];
      pharmacies?: unknown[];
    } = { centre: { lat: dto.lat, lng: dto.lng }, rayonKm: rayon };

    if (cible === 'ETABLISSEMENTS' || cible === 'TOUS') {
      const etabs = await this.prisma.etablissementSante.findMany({
        where: {
          organisationId: ctx.organisationId,
          deletedAt: null,
          statut: 'ACTIF',
          latitude: { not: null },
          longitude: { not: null },
        },
      });
      resultat.etablissements = this.trierParDistance(
        etabs,
        dto.lat,
        dto.lng,
        rayon,
        limite,
      );
    }

    if (cible === 'PHARMACIES' || cible === 'TOUS') {
      const pharms = await this.prisma.pharmacie.findMany({
        where: {
          organisationId: ctx.organisationId,
          deletedAt: null,
          statut: 'ACTIVE',
          latitude: { not: null },
          longitude: { not: null },
        },
      });
      resultat.pharmacies = this.trierParDistance(
        pharms,
        dto.lat,
        dto.lng,
        rayon,
        limite,
      );
    }

    return resultat;
  }

  /**
   * Filtre les lieux dans le rayon et les renvoie triés par distance croissante,
   * chacun enrichi de `distanceKm` (2 décimales).
   */
  private trierParDistance<T extends PointGeo>(
    lieux: T[],
    lat: number,
    lng: number,
    rayonKm: number,
    limite: number,
  ): (T & { distanceKm: number })[] {
    return lieux
      .map((lieu) => ({
        ...lieu,
        distanceKm: this.distanceHaversineKm(
          lat,
          lng,
          lieu.latitude as number,
          lieu.longitude as number,
        ),
      }))
      .filter((l) => l.distanceKm <= rayonKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limite)
      .map((l) => ({ ...l, distanceKm: Number(l.distanceKm.toFixed(2)) }));
  }

  /** Distance orthodromique (Haversine) en kilomètres. */
  private distanceHaversineKm(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371; // rayon moyen de la Terre en km
    const rad = (d: number) => (d * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // --- Autorisation / helpers ------------------------------------

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
      (ROLES_GESTION_RESEAU as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        'La gestion du réseau de soins est réservée à ASSUREUR_INFORMATIQUE.',
      );
    }
  }

  private async assertCodeLibre(
    modele: 'etablissementSante' | 'pharmacie',
    code: string,
  ): Promise<void> {
    const existe =
      modele === 'etablissementSante'
        ? await this.prisma.etablissementSante.findUnique({ where: { code } })
        : await this.prisma.pharmacie.findUnique({ where: { code } });
    if (existe) {
      throw new ConflictException(`Le code « ${code} » est déjà utilisé.`);
    }
  }

  private lieuUpdateData(
    dto: UpdateEtablissementDto | UpdatePharmacieDto,
  ): Record<string, unknown> {
    const d: Record<string, unknown> = {};
    for (const [cle, valeur] of Object.entries(dto)) {
      if (valeur === undefined) continue;
      if (
        (cle === 'dateConvention' || cle === 'dateFinConvention') &&
        typeof valeur === 'string'
      ) {
        d[cle] = new Date(valeur);
      } else {
        d[cle] = valeur;
      }
    }
    return d;
  }

  private async chargerEtablissement(organisationId: string, id: string) {
    const e = await this.prisma.etablissementSante.findFirst({
      where: { id, organisationId, deletedAt: null },
    });
    if (!e) {
      throw new NotFoundException('Établissement introuvable.');
    }
    return e;
  }

  private async assertEtablissementDansPerimetre(
    organisationId: string,
    id: string,
  ) {
    const e = await this.prisma.etablissementSante.findFirst({
      where: { id, organisationId, deletedAt: null },
    });
    if (!e) {
      throw new NotFoundException('Établissement introuvable.');
    }
    return e;
  }

  private async chargerPharmacie(organisationId: string, id: string) {
    const p = await this.prisma.pharmacie.findFirst({
      where: { id, organisationId, deletedAt: null },
    });
    if (!p) {
      throw new NotFoundException('Pharmacie introuvable.');
    }
    return p;
  }

  private async assertPharmacieDansPerimetre(
    organisationId: string,
    id: string,
  ) {
    const p = await this.prisma.pharmacie.findFirst({
      where: { id, organisationId, deletedAt: null },
    });
    if (!p) {
      throw new NotFoundException('Pharmacie introuvable.');
    }
    return p;
  }

  /** Écriture d'audit — toujours via `log_audit()` (v9 §1.6). */
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
