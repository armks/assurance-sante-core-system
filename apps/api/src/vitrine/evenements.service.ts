import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreerEvenementDto, ModifierEvenementDto } from './dto/evenement.dto';
import { LimiteurRequetes } from './limiteur-requetes';
import { LIMITE_EVENEMENTS } from './vitrine.types';

/** Fichier reçu par `FileInterceptor` (multer, stockage mémoire). */
export interface FichierImage {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export type StatutEvenement = 'A_VENIR' | 'PASSE';

/** Événement tel que publié sur la page d'accueil : aucun champ interne. */
export interface EvenementPublic {
  id: string;
  titre: string;
  description: string | null;
  imageUrl: string;
  dateEvenement: string;
  statut: StatutEvenement;
}

/** Seul rôle autorisé à gérer les événements (rôle EXACT, pas l'adjoint). */
export const ROLE_GESTION_EVENEMENTS = 'ASSUREUR_INFORMATIQUE';
export const NB_MAX_EVENEMENTS_PUBLICS = 5;
export const TAILLE_MAX_IMAGE_EVENEMENT = 5 * 1024 * 1024;
const BUCKET = 'evenements';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Format d'image d'après ses OCTETS (jamais d'après l'extension ni le
 * `mimetype` déclaré par le client) : JPEG, PNG ou WEBP. Le bucket étant
 * public, le `Content-Type` servi est celui déduit ici — un SVG ou un HTML
 * renommé en .jpg est refusé.
 */
export function formatImageEvenement(o: Buffer): { mime: string; ext: string } | null {
  if (o.length >= 3 && o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (o.length >= 8 && o.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (o.length >= 12 && o.toString('ascii', 0, 4) === 'RIFF' && o.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/** Date du jour AAAA-MM-JJ en UTC (= heure d'Abidjan). */
const aujourdhui = (maintenant: Date) => maintenant.toISOString().slice(0, 10);
const jour = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Statut calculé : l'événement du jour est encore « à venir » (il a lieu
 * aujourd'hui) ; il devient « passé » le lendemain.
 */
export function statutEvenement(dateEvenement: Date, maintenant: Date): StatutEvenement {
  return jour(dateEvenement) >= aujourdhui(maintenant) ? 'A_VENIR' : 'PASSE';
}

/**
 * Sélection publique (5 au plus) : `ordreAffichage` d'abord — l'informaticien
 * de l'assureur garde la main sur la mise en avant —, puis, à ordre égal, les
 * événements à venir avant les passés, les plus proches dans le temps en
 * premier (à venir : date croissante ; passés : date décroissante).
 */
export function selectionPublique<T extends { ordreAffichage: number; dateEvenement: Date }>(
  evenements: T[],
  maintenant: Date,
): T[] {
  const cle = (e: T) => {
    const avenir = statutEvenement(e.dateEvenement, maintenant) === 'A_VENIR';
    const t = e.dateEvenement.getTime();
    return [e.ordreAffichage, avenir ? 0 : 1, avenir ? t : -t] as const;
  };
  return [...evenements]
    .sort((a, b) => {
      const [a1, a2, a3] = cle(a);
      const [b1, b2, b3] = cle(b);
      return a1 - b1 || a2 - b2 || a3 - b3;
    })
    .slice(0, NB_MAX_EVENEMENTS_PUBLICS);
}

/**
 * EvenementsService — événements de la vitrine (carrousel du bloc « Qui
 * sommes-nous »). Gestion réservée à ASSUREUR_INFORMATIQUE de l'organisation
 * (RLS `evenements_ecriture` en défense en profondeur). Images dans le bucket
 * PUBLIC `evenements` (prisma/sql/060), écrites uniquement ici (service_role).
 */
@Injectable()
export class EvenementsService {
  private readonly logger = new Logger(EvenementsService.name);
  private readonly limitePublique = new LimiteurRequetes(LIMITE_EVENEMENTS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  /** Horloge (surchargée dans les tests). */
  maintenant(): Date {
    return new Date();
  }

  // --- Gestion (ASSUREUR_INFORMATIQUE) ---------------------------------

  async lister(user: AuthenticatedUser) {
    const ctx = await this.contexteGestion(user);
    const lignes = await this.prisma.evenement.findMany({
      where: { organisationId: ctx.organisationId, deletedAt: null },
      orderBy: [{ ordreAffichage: 'asc' }, { dateEvenement: 'desc' }],
    });
    const maintenant = this.maintenant();
    return lignes.map((e) => this.versSortie(e, maintenant));
  }

  async creer(user: AuthenticatedUser, dto: CreerEvenementDto, fichier?: FichierImage) {
    const ctx = await this.contexteGestion(user);
    if (!fichier) throw new BadRequestException('Une image est requise pour créer un événement.');
    const image = this.validerImage(fichier);

    const id = randomUUID();
    const chemin = `${ctx.organisationId}/${id}-${Date.now()}.${image.ext}`;
    await this.televerser(chemin, fichier.buffer, image.mime);
    try {
      const cree = await this.prisma.evenement.create({
        data: {
          id,
          organisationId: ctx.organisationId,
          titre: dto.titre,
          description: dto.description ?? null,
          imageUrl: this.urlPublique(chemin),
          dateEvenement: new Date(`${dto.dateEvenement}T00:00:00Z`),
          ordreAffichage: dto.ordreAffichage ?? 0,
          actif: dto.actif ?? true,
        },
      });
      await this.audit(ctx.userId, 'CREATION_EVENEMENT', id, { titre: dto.titre, chemin });
      return this.versSortie(cree, this.maintenant());
    } catch (e) {
      await this.supprimerObjet(chemin); // pas d'image orpheline publique
      throw e;
    }
  }

  async modifier(user: AuthenticatedUser, id: string, dto: ModifierEvenementDto, fichier?: FichierImage) {
    const ctx = await this.contexteGestion(user);
    const existant = await this.charger(ctx.organisationId, id);

    let imageUrl: string | undefined;
    let nouveauChemin: string | undefined;
    if (fichier) {
      const image = this.validerImage(fichier);
      nouveauChemin = `${ctx.organisationId}/${id}-${Date.now()}.${image.ext}`;
      await this.televerser(nouveauChemin, fichier.buffer, image.mime);
      imageUrl = this.urlPublique(nouveauChemin);
    }

    const maj = await this.prisma.evenement.update({
      where: { id },
      data: {
        ...(dto.titre !== undefined ? { titre: dto.titre } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.dateEvenement !== undefined ? { dateEvenement: new Date(`${dto.dateEvenement}T00:00:00Z`) } : {}),
        ...(dto.ordreAffichage !== undefined ? { ordreAffichage: dto.ordreAffichage } : {}),
        ...(dto.actif !== undefined ? { actif: dto.actif } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      },
    });
    if (nouveauChemin) await this.supprimerObjet(this.cheminDepuisUrl(existant.imageUrl));
    await this.audit(ctx.userId, 'MODIFICATION_EVENEMENT', id, {
      champs: Object.keys(dto),
      ...(nouveauChemin ? { chemin: nouveauChemin } : {}),
    });
    return this.versSortie(maj, this.maintenant());
  }

  /** Suppression logique ; l'image publique est retirée du bucket. */
  async supprimer(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteGestion(user);
    const existant = await this.charger(ctx.organisationId, id);
    await this.prisma.evenement.update({ where: { id }, data: { deletedAt: this.maintenant(), actif: false } });
    await this.supprimerObjet(this.cheminDepuisUrl(existant.imageUrl));
    await this.audit(ctx.userId, 'SUPPRESSION_EVENEMENT', id, null);
    return { ok: true };
  }

  // --- Lecture publique ------------------------------------------------

  /**
   * Événements publiés (5 au plus) de l'organisation vitrine
   * (`VITRINE_ORGANISATION_ID`). Variable absente ou invalide : liste vide —
   * jamais les événements d'une autre organisation par défaut.
   */
  async publics(ip: string): Promise<EvenementPublic[]> {
    const r = this.limitePublique.consommer(ip);
    if (!r.autorise) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Trop de tentatives. Merci de réessayer dans ${Math.ceil(r.reessayerDansS / 60)} min.`,
          reessayerDansS: r.reessayerDansS,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const organisationId = process.env.VITRINE_ORGANISATION_ID?.trim();
    if (!organisationId || !UUID.test(organisationId)) return [];
    const lignes = await this.prisma.evenement.findMany({
      where: { organisationId, actif: true, deletedAt: null },
    });
    const maintenant = this.maintenant();
    return selectionPublique(lignes, maintenant).map((e) => ({
      id: e.id,
      titre: e.titre,
      description: e.description,
      imageUrl: e.imageUrl,
      dateEvenement: jour(e.dateEvenement),
      statut: statutEvenement(e.dateEvenement, maintenant),
    }));
  }

  // --- Aides -------------------------------------------------------------

  private async contexteGestion(user: AuthenticatedUser) {
    const { profil } = await this.identity.getMe(user);
    if (profil.role !== ROLE_GESTION_EVENEMENTS) {
      throw new ForbiddenException('La gestion des événements est réservée à ASSUREUR_INFORMATIQUE.');
    }
    if (!profil.organisationId) {
      throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    }
    return { userId: profil.id, organisationId: profil.organisationId };
  }

  private async charger(organisationId: string, id: string) {
    const e = await this.prisma.evenement.findFirst({ where: { id, organisationId, deletedAt: null } });
    if (!e) throw new NotFoundException('Événement introuvable.');
    return e;
  }

  private versSortie(
    e: {
      id: string;
      titre: string;
      description: string | null;
      imageUrl: string;
      dateEvenement: Date;
      ordreAffichage: number;
      actif: boolean;
      createdAt: Date;
      updatedAt: Date;
    },
    maintenant: Date,
  ) {
    return {
      id: e.id,
      titre: e.titre,
      description: e.description,
      imageUrl: e.imageUrl,
      dateEvenement: jour(e.dateEvenement),
      statut: statutEvenement(e.dateEvenement, maintenant),
      ordreAffichage: e.ordreAffichage,
      actif: e.actif,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }

  private validerImage(fichier: FichierImage) {
    if (fichier.size > TAILLE_MAX_IMAGE_EVENEMENT) {
      throw new BadRequestException('Image trop volumineuse (5 Mo au maximum).');
    }
    const format = formatImageEvenement(fichier.buffer);
    if (!format) throw new BadRequestException('Formats d’image acceptés : JPEG, PNG, WEBP.');
    return format;
  }

  private get baseStorage(): string {
    return `${(process.env.SUPABASE_URL ?? '').replace(/\/$/, '')}/storage/v1`;
  }

  private get serviceKey(): string {
    return process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  }

  private urlPublique(chemin: string): string {
    return `${this.baseStorage}/object/public/${BUCKET}/${chemin}`;
  }

  /** Chemin dans le bucket à partir de l'URL publique stockée (`null` si étrangère). */
  private cheminDepuisUrl(url: string): string | null {
    const prefixe = `${this.baseStorage}/object/public/${BUCKET}/`;
    return url.startsWith(prefixe) ? url.slice(prefixe.length) : null;
  }

  private async televerser(chemin: string, octets: Buffer, mime: string): Promise<void> {
    if (!process.env.SUPABASE_URL || !this.serviceKey) {
      throw new ServiceUnavailableException(
        'Stockage des images indisponible : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.',
      );
    }
    const res = await fetch(`${this.baseStorage}/object/${BUCKET}/${chemin}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
        apikey: this.serviceKey,
        'Content-Type': mime,
        'x-upsert': 'false',
        // Cache CDN des objets publics (3600 s par défaut) : une image supprimée
        // reste servie jusqu'à expiration — ramené à 5 min. Le nom de fichier
        // horodaté rend inutile toute invalidation au remplacement.
        'cache-control': 'max-age=300',
      },
      body: octets as unknown as BodyInit,
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Téléversement de l'image refusé (${res.status} : ${(await res.text()).slice(0, 200)}).`,
      );
    }
  }

  /** Meilleur effort : un échec de nettoyage n'annule pas l'opération. */
  private async supprimerObjet(chemin: string | null): Promise<void> {
    if (!chemin || !process.env.SUPABASE_URL || !this.serviceKey) return;
    try {
      const res = await fetch(`${this.baseStorage}/object/${BUCKET}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.serviceKey}`,
          apikey: this.serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefixes: [chemin] }),
      });
      if (!res.ok) this.logger.warn(`Image non supprimée (${res.status}) : ${chemin}`);
    } catch (e) {
      this.logger.warn(`Image non supprimée : ${chemin} — ${e instanceof Error ? e.message : e}`);
    }
  }

  private async audit(userId: string, action: string, id: string, details: object | null): Promise<void> {
    await this.prisma.$executeRaw`
      SELECT log_audit(
        ${action}::text,
        ${'evenements'}::text,
        ${id}::uuid,
        ${userId}::uuid,
        ${details === null ? null : JSON.stringify(details)}::jsonb
      )`;
  }
}
