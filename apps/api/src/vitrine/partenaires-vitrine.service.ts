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
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreerPartenaireDto, ModifierPartenaireDto } from './dto/partenaire.dto';
import { formatImageEvenement, ROLE_GESTION_EVENEMENTS, type FichierImage } from './evenements.service';
import { LimiteurRequetes } from './limiteur-requetes';
import { LIMITE_EVENEMENTS } from './vitrine.types';

/** Partenaire tel que publié sur la page d'accueil : aucun champ interne. */
export interface PartenairePublic {
  id: string;
  nom: string;
  logoUrl: string;
  siteUrl: string | null;
}

/** Seul rôle autorisé à gérer les logos partenaires : celui des événements (ASSUREUR_INFORMATIQUE exact, pas l'adjoint). */
export const ROLE_GESTION_PARTENAIRES = ROLE_GESTION_EVENEMENTS;
/** Plafond de logos ACTIFS par société : au-delà le bandeau n'a plus de sens (et la page devient lourde). */
export const NB_MAX_PARTENAIRES_ACTIFS = 30;
export const TAILLE_MAX_LOGO_PARTENAIRE = 5 * 1024 * 1024;
/** Bucket PUBLIC des images de la vitrine (prisma/sql/060) — les logos sont rangés sous `{organisation}/partenaires/`. */
const BUCKET = 'evenements';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PartenairesVitrineService — logos des partenaires d'une société, en bandeau défilant sous la bannière de SA page d'accueil.
 * Gestion réservée à ASSUREUR_INFORMATIQUE de l'organisation (RLS `partenaires_vitrine_ecriture` en défense en profondeur) ; chaque
 * société ne voit et ne modifie que SES logos. Lecture publique limitée (même limiteur que les événements).
 */
@Injectable()
export class PartenairesVitrineService {
  private readonly logger = new Logger(PartenairesVitrineService.name);
  private readonly limitePublique = new LimiteurRequetes(LIMITE_EVENEMENTS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  // --- Gestion (ASSUREUR_INFORMATIQUE) ---------------------------------

  async lister(user: AuthenticatedUser) {
    const ctx = await this.contexteGestion(user);
    const lignes = await this.prisma.partenaireVitrine.findMany({
      where: { organisationId: ctx.organisationId, deletedAt: null },
      orderBy: [{ ordreAffichage: 'asc' }, { createdAt: 'asc' }],
    });
    return lignes.map((l) => this.versSortie(l));
  }

  async creer(user: AuthenticatedUser, dto: CreerPartenaireDto, fichier?: FichierImage) {
    const ctx = await this.contexteGestion(user);
    if (!fichier) throw new BadRequestException('Un logo (image) est requis pour ajouter un partenaire.');
    const image = this.validerImage(fichier);
    if ((dto.actif ?? true) && (await this.nbActifs(ctx.organisationId)) >= NB_MAX_PARTENAIRES_ACTIFS) {
      throw new BadRequestException(`Au plus ${NB_MAX_PARTENAIRES_ACTIFS} logos actifs : archivez-en un avant d'en ajouter.`);
    }
    const id = randomUUID();
    const chemin = `${ctx.organisationId}/partenaires/${id}-${Date.now()}.${image.ext}`;
    await this.televerser(chemin, fichier.buffer, image.mime);
    try {
      const cree = await this.prisma.$transaction(async (tx) => {
        const c = await tx.partenaireVitrine.create({
          data: {
            id,
            organisationId: ctx.organisationId,
            nom: dto.nom,
            logoUrl: this.urlPublique(chemin),
            siteUrl: dto.siteUrl?.trim() || null,
            ordreAffichage: dto.ordreAffichage ?? 0,
            actif: dto.actif ?? true,
          },
        });
        await this.audit(ctx.userId, 'CREATION_PARTENAIRE_VITRINE', id, { nom: dto.nom, chemin }, tx);
        return c;
      });
      return this.versSortie(cree);
    } catch (e) {
      await this.supprimerObjet(chemin); // pas d'image orpheline publique
      throw e;
    }
  }

  async modifier(user: AuthenticatedUser, id: string, dto: ModifierPartenaireDto, fichier?: FichierImage) {
    const ctx = await this.contexteGestion(user);
    const existant = await this.charger(ctx.organisationId, id);
    if (dto.actif === true && !existant.actif && (await this.nbActifs(ctx.organisationId)) >= NB_MAX_PARTENAIRES_ACTIFS) {
      throw new BadRequestException(`Au plus ${NB_MAX_PARTENAIRES_ACTIFS} logos actifs : archivez-en un avant d'en réactiver.`);
    }
    let logoUrl: string | undefined;
    let nouveauChemin: string | undefined;
    if (fichier) {
      const image = this.validerImage(fichier);
      nouveauChemin = `${ctx.organisationId}/partenaires/${id}-${Date.now()}.${image.ext}`;
      await this.televerser(nouveauChemin, fichier.buffer, image.mime);
      logoUrl = this.urlPublique(nouveauChemin);
    }
    let maj;
    try {
      maj = await this.prisma.$transaction(async (tx) => {
        const m = await tx.partenaireVitrine.update({
          where: { id },
          data: {
            ...(dto.nom !== undefined ? { nom: dto.nom } : {}),
            ...(dto.siteUrl !== undefined ? { siteUrl: dto.siteUrl.trim() || null } : {}),
            ...(dto.ordreAffichage !== undefined ? { ordreAffichage: dto.ordreAffichage } : {}),
            ...(dto.actif !== undefined ? { actif: dto.actif } : {}),
            ...(logoUrl ? { logoUrl } : {}),
          },
        });
        await this.audit(ctx.userId, 'MODIFICATION_PARTENAIRE_VITRINE', id, { champs: Object.keys(dto), ...(nouveauChemin ? { chemin: nouveauChemin } : {}) }, tx);
        return m;
      });
    } catch (e) {
      if (nouveauChemin) await this.supprimerObjet(nouveauChemin);
      throw e;
    }
    // l'ancien logo n'est effacé du stockage qu'après validation de la modification
    if (nouveauChemin) await this.supprimerObjet(this.cheminDepuisUrl(existant.logoUrl));
    return this.versSortie(maj);
  }

  /** Suppression logique ; le logo public est retiré du bucket. */
  async supprimer(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteGestion(user);
    const existant = await this.charger(ctx.organisationId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.partenaireVitrine.update({ where: { id }, data: { deletedAt: new Date(), actif: false } });
      await this.audit(ctx.userId, 'SUPPRESSION_PARTENAIRE_VITRINE', id, { nom: existant.nom }, tx);
    });
    await this.supprimerObjet(this.cheminDepuisUrl(existant.logoUrl));
    return { ok: true };
  }

  // --- Lecture publique --------------------------------------------------

  /**
   * Logos actifs affichés dans le bandeau : ceux de l'organisation vitrine (`VITRINE_ORGANISATION_ID`) — ou, pour la page d'une société
   * (/{slug}), de CETTE société seulement. Variable absente ou invalide, slug inconnu : liste vide — jamais les logos d'une autre
   * organisation par défaut.
   */
  async publics(ip: string, slugOrganisation?: string): Promise<PartenairePublic[]> {
    const r = this.limitePublique.consommer(ip);
    if (!r.autorise) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: `Trop de tentatives. Merci de réessayer dans ${Math.ceil(r.reessayerDansS / 60)} min.`, reessayerDansS: r.reessayerDansS },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const organisationId = slugOrganisation
      ? (await this.prisma.organisation.findFirst({ where: { slug: slugOrganisation, deletedAt: null, statut: 'ACTIVE' }, select: { id: true } }))?.id
      : process.env.VITRINE_ORGANISATION_ID?.trim();
    if (!organisationId || !UUID.test(organisationId)) return [];
    const lignes = await this.prisma.partenaireVitrine.findMany({
      where: { organisationId, actif: true, deletedAt: null },
      orderBy: [{ ordreAffichage: 'asc' }, { createdAt: 'asc' }],
      take: NB_MAX_PARTENAIRES_ACTIFS,
    });
    return lignes.map((l) => ({ id: l.id, nom: l.nom, logoUrl: l.logoUrl, siteUrl: l.siteUrl }));
  }

  // --- Aides -------------------------------------------------------------

  private async contexteGestion(user: AuthenticatedUser) {
    const { profil } = await this.identity.getMe(user);
    if (profil.role !== ROLE_GESTION_PARTENAIRES) {
      throw new ForbiddenException('La gestion des logos partenaires est réservée à ASSUREUR_INFORMATIQUE.');
    }
    if (!profil.organisationId) throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    return { userId: profil.id, organisationId: profil.organisationId };
  }

  private async charger(organisationId: string, id: string) {
    const p = await this.prisma.partenaireVitrine.findFirst({ where: { id, organisationId, deletedAt: null } });
    if (!p) throw new NotFoundException('Partenaire introuvable.');
    return p;
  }

  private nbActifs(organisationId: string) {
    return this.prisma.partenaireVitrine.count({ where: { organisationId, actif: true, deletedAt: null } });
  }

  private versSortie(p: { id: string; nom: string; logoUrl: string; siteUrl: string | null; ordreAffichage: number; actif: boolean; createdAt: Date; updatedAt: Date }) {
    return { id: p.id, nom: p.nom, logoUrl: p.logoUrl, siteUrl: p.siteUrl, ordreAffichage: p.ordreAffichage, actif: p.actif, createdAt: p.createdAt, updatedAt: p.updatedAt };
  }

  /** Format d'après les OCTETS (jamais l'extension ni le type déclaré) : JPEG, PNG ou WEBP ; le bucket étant public, un SVG / HTML déguisé est refusé. */
  private validerImage(fichier: FichierImage) {
    if (fichier.size > TAILLE_MAX_LOGO_PARTENAIRE) throw new BadRequestException('Logo trop volumineux (5 Mo au maximum).');
    const format = formatImageEvenement(fichier.buffer);
    if (!format) throw new BadRequestException('Formats de logo acceptés : JPEG, PNG, WEBP.');
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

  private cheminDepuisUrl(url: string): string | null {
    const prefixe = `${this.baseStorage}/object/public/${BUCKET}/`;
    return url.startsWith(prefixe) ? url.slice(prefixe.length) : null;
  }

  private async televerser(chemin: string, octets: Buffer, mime: string): Promise<void> {
    if (!process.env.SUPABASE_URL || !this.serviceKey) {
      throw new ServiceUnavailableException('Stockage des images indisponible : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.');
    }
    const res = await fetch(`${this.baseStorage}/object/${BUCKET}/${chemin}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, 'Content-Type': mime, 'x-upsert': 'false', 'cache-control': 'max-age=300' },
      body: octets as unknown as BodyInit,
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`Téléversement du logo refusé (${res.status} : ${(await res.text()).slice(0, 200)}).`);
    }
  }

  /** Meilleur effort : un échec de nettoyage n'annule pas l'opération. */
  private async supprimerObjet(chemin: string | null): Promise<void> {
    if (!chemin || !process.env.SUPABASE_URL || !this.serviceKey) return;
    try {
      const res = await fetch(`${this.baseStorage}/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [chemin] }),
      });
      if (!res.ok) this.logger.warn(`Logo non supprimé (${res.status}) : ${chemin}`);
    } catch (e) {
      this.logger.warn(`Logo non supprimé : ${chemin} — ${e instanceof Error ? e.message : e}`);
    }
  }

  private async audit(userId: string, action: string, id: string, details: object | null, db: Prisma.TransactionClient): Promise<void> {
    await db.$executeRaw`
      SELECT log_audit(
        ${action}::text,
        ${'partenaires_vitrine'}::text,
        ${id}::uuid,
        ${userId}::uuid,
        ${details === null ? null : JSON.stringify(details)}::jsonb
      )`;
  }
}
