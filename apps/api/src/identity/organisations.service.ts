import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { formatImagePdf } from '../common/images.util';
import { erreurSlug } from '../common/slug.util';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from './identity.service';

const ROLE_SUPERADMIN = 'SUPERADMIN_PRINCIPAL';

/** Bucket PUBLIC en lecture (prisma/sql/058) — logo imprimé sur la carte. */
const BUCKET_LOGOS = 'logos';
const TAILLE_MAX_LOGO_OCTETS = 2 * 1024 * 1024;

/** Fichier reçu par `FileInterceptor` (multer, stockage mémoire). */
export interface FichierLogo {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * OrganisationsService — lecture des tenants racine par le superadministrateur
 * (interface /superadmin). La CRÉATION d'une organisation ne passe plus par ici :
 * elle se fait en deux temps via `SuperadminActionsService` (code par e-mail,
 * PROMPT 22) — il n'existe plus de route de création directe.
 */
@Injectable()
export class OrganisationsService {
  private readonly logger = new Logger(OrganisationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  async lister(user: AuthenticatedUser) {
    await this.assertSuperadmin(user);
    return this.prisma.organisation.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { licence: true },
    });
  }

  /**
   * Chemin de la page d'accueil dédiée (/{slug}) — réservé EXCLUSIVEMENT à
   * SUPERADMIN_PRINCIPAL, comme le logo. Format, segments réservés et unicité
   * vérifiés ici (et par les contraintes SQL de prisma/sql/061).
   */
  async modifierSlug(user: AuthenticatedUser, organisationId: string, slugPropose: string) {
    const { userId } = await this.assertSuperadminPrincipal(user);
    const slug = slugPropose.trim().toLowerCase();
    const erreur = erreurSlug(slug);
    if (erreur) throw new BadRequestException(erreur);
    const organisation = await this.prisma.organisation.findFirst({
      where: { id: organisationId, deletedAt: null },
      select: { id: true, slug: true },
    });
    if (!organisation) throw new NotFoundException('Organisation introuvable.');
    if (organisation.slug === slug) return { slug };
    const pris = (await this.prisma.organisation.count({ where: { slug, deletedAt: null } })) > 0;
    if (pris) throw new ConflictException(`Le chemin « /${slug} » est déjà utilisé par une autre organisation.`);
    await this.prisma.organisation.update({ where: { id: organisationId }, data: { slug } });
    await this.audit(userId, organisationId, { slug, ancienSlug: organisation.slug }, 'MODIFICATION_SLUG_ORGANISATION');
    return { slug };
  }

  /**
   * Logo de l'organisation (en-tête de la carte de membre) — réservé
   * EXCLUSIVEMENT à SUPERADMIN_PRINCIPAL. PNG/JPEG vérifiés par les octets
   * (les seuls formats que la carte PDF sait afficher). Chaque logo est stocké
   * sous un nom unique (horodaté) puis l'ancien est supprimé : le bucket étant
   * public, un nom constant resterait servi en cache (CDN, navigateur) après
   * remplacement.
   */
  async modifierLogoOrganisation(
    user: AuthenticatedUser,
    organisationId: string,
    fichier: FichierLogo | undefined,
  ) {
    const { userId } = await this.assertSuperadminPrincipal(user);
    const organisation = await this.prisma.organisation.findFirst({
      where: { id: organisationId, deletedAt: null },
      select: { id: true, logoUrl: true },
    });
    if (!organisation) {
      throw new NotFoundException('Organisation introuvable.');
    }
    if (!fichier?.buffer?.length) {
      throw new BadRequestException('Aucun fichier reçu (champ « logo »).');
    }
    if (fichier.size > TAILLE_MAX_LOGO_OCTETS) {
      throw new BadRequestException('Logo trop volumineux (max 2 Mo).');
    }
    const format = formatImagePdf(fichier.buffer);
    if (!format) {
      throw new BadRequestException('Formats de logo acceptés : PNG, JPEG.');
    }

    const chemin = `${organisationId}/logo-${Date.now()}.${format}`;
    await this.storage('POST', `object/${BUCKET_LOGOS}/${chemin}`, {
      'Content-Type': format === 'png' ? 'image/png' : 'image/jpeg',
      body: fichier.buffer,
    });
    const logoUrl = `${this.baseStorage}/object/public/${BUCKET_LOGOS}/${chemin}`;

    await this.prisma.organisation.update({
      where: { id: organisationId },
      data: { logoUrl },
    });
    await this.audit(userId, organisationId, {
      logoUrl,
      ancienLogoUrl: organisation.logoUrl,
    });

    // Ancien logo : supprimé APRÈS la mise à jour (jamais de carte pointant
    // vers un objet absent). Un échec ici ne remet pas en cause le nouveau logo.
    const ancienChemin = this.cheminDepuisUrl(organisation.logoUrl);
    if (ancienChemin && ancienChemin !== chemin) {
      try {
        await this.storage('DELETE', `object/${BUCKET_LOGOS}`, {
          'Content-Type': 'application/json',
          body: JSON.stringify({ prefixes: [ancienChemin] }),
        });
      } catch (error) {
        this.logger.warn(
          `Ancien logo non supprimé (${ancienChemin}) : ${error instanceof Error ? error.message : 'erreur inconnue'}`,
        );
      }
    }

    return { logoUrl };
  }

  private cheminDepuisUrl(url: string | null): string | null {
    const marque = `/object/public/${BUCKET_LOGOS}/`;
    const i = url?.indexOf(marque) ?? -1;
    return url && i >= 0 ? url.slice(i + marque.length) : null;
  }

  private get baseStorage(): string {
    return `${(process.env.SUPABASE_URL ?? '').replace(/\/$/, '')}/storage/v1`;
  }

  /** Appel à l'API Storage avec la clé `service_role` (seule autorisée à
   * écrire dans le bucket, aucune policy d'écriture côté client). */
  private async storage(
    methode: 'POST' | 'DELETE',
    chemin: string,
    options: { 'Content-Type': string; body: Buffer | string },
  ): Promise<void> {
    const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!process.env.SUPABASE_URL || !cle) {
      throw new ServiceUnavailableException(
        'Stockage indisponible : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.',
      );
    }
    const res = await fetch(`${this.baseStorage}/${chemin}`, {
      method: methode,
      headers: {
        Authorization: `Bearer ${cle}`,
        apikey: cle,
        'Content-Type': options['Content-Type'],
      },
      body: options.body as unknown as BodyInit,
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Stockage du logo refusé (${res.status} : ${(await res.text()).slice(0, 200)}).`,
      );
    }
  }

  /** Écriture d'audit — toujours via `log_audit()` (v9 §1.6). */
  private async audit(
    userId: string,
    organisationId: string,
    details: Record<string, string | null>,
    action = 'MODIFICATION_LOGO_ORGANISATION',
  ): Promise<void> {
    await this.prisma.$executeRaw`
      SELECT log_audit(
        ${action}::text,
        ${'organisations'}::text,
        ${organisationId}::uuid,
        ${userId}::uuid,
        ${JSON.stringify(details)}::jsonb
      )`;
  }

  /**
   * EXCLUSIVEMENT SUPERADMIN_PRINCIPAL : contrôle du rôle PROPRE du compte, pas
   * de la chaîne héritée — `SUPERADMIN_UTILISATEUR_ADMIN` a SUPERADMIN_PRINCIPAL
   * pour parent (sous_roles) et passerait un simple `roleChain.includes`.
   */
  private async assertSuperadminPrincipal(
    user: AuthenticatedUser,
  ): Promise<{ userId: string }> {
    const { profil } = await this.identity.getMe(user);
    if (profil.role !== ROLE_SUPERADMIN) {
      throw new ForbiddenException('Action réservée exclusivement au superadministrateur principal.');
    }
    return { userId: profil.id };
  }

  private async assertSuperadmin(
    user: AuthenticatedUser,
  ): Promise<{ userId: string }> {
    const { profil, permissions } = await this.identity.getMe(user);
    const roleChain = permissions?.roleChain ?? [];
    if (!roleChain.includes(ROLE_SUPERADMIN)) {
      throw new ForbiddenException('Action réservée au superadministrateur.');
    }
    return { userId: profil.id };
  }
}
