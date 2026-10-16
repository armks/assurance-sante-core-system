import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreerAnnonceDto, ModifierAnnonceDto } from './dto/annonce.dto';
import { LimiteurRequetes } from './limiteur-requetes';
import { LIMITE_EVENEMENTS } from './vitrine.types';

/** Annonce telle que servie au public : aucun champ interne. */
export interface AnnoncePublique {
  id: string;
  texte: string;
  dureeAffichageSecondes: number;
}

const ROLES_SUPERADMIN = ['SUPERADMIN_PRINCIPAL', 'SUPERADMIN_UTILISATEUR_ADMIN'];
/** Rôle de la société d'assurance habilité à diffuser sur SA page d'accueil (rôle exact, comme les événements). */
export const ROLE_GESTION_ANNONCES = 'ASSUREUR_INFORMATIQUE';
const NB_MAX_ANNONCES_PUBLIQUES = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bandeau défilant du bas de la page d'accueil : une annonce a une portée (une société, ou toutes les pages d'accueil pour le
 * superadmin), une durée d'affichage et une fenêtre de diffusion facultative. La société gère SES annonces ; le superadmin gère
 * toutes les annonces et peut diffuser à toute la plateforme.
 */
@Injectable()
export class AnnoncesService {
  private readonly limitePublique = new LimiteurRequetes(LIMITE_EVENEMENTS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  // --- Lecture publique --------------------------------------------------

  /** Annonces actives de la page d'accueil : celles de la société `slug` (ou de l'organisation vitrine) + celles de toute la plateforme. */
  async publiques(ip: string, slugOrganisation?: string): Promise<AnnoncePublique[]> {
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
    const maintenant = new Date();
    const lignes = await this.prisma.annonceBandeau.findMany({
      where: {
        actif: true,
        deletedAt: null,
        dateDebut: { lte: maintenant },
        OR: [{ dateFin: null }, { dateFin: { gt: maintenant } }],
        AND: [{ OR: [{ organisationId: null }, ...(organisationId && UUID.test(organisationId) ? [{ organisationId }] : [])] }],
      },
      orderBy: [{ createdAt: 'desc' }],
      take: NB_MAX_ANNONCES_PUBLIQUES,
    });
    return lignes.map((l) => ({ id: l.id, texte: l.texte, dureeAffichageSecondes: l.dureeAffichageSecondes }));
  }

  // --- Gestion -----------------------------------------------------------

  async lister(user: AuthenticatedUser) {
    const ctx = await this.contexteGestion(user);
    const lignes = await this.prisma.annonceBandeau.findMany({
      where: { deletedAt: null, ...(ctx.superadmin ? {} : { organisationId: ctx.organisationId }) },
      orderBy: [{ createdAt: 'desc' }],
      include: { organisation: { select: { nom: true, slug: true } } },
    });
    const maintenant = Date.now();
    return lignes.map((l) => ({
      id: l.id,
      texte: l.texte,
      dureeAffichageSecondes: l.dureeAffichageSecondes,
      dateDebut: l.dateDebut,
      dateFin: l.dateFin,
      actif: l.actif,
      organisationId: l.organisationId,
      portee: l.organisationId ? (l.organisation?.nom ?? 'Société') : 'Toutes les pages d’accueil',
      // en cours de diffusion = active, commencée, non terminée
      enDiffusion: l.actif && l.dateDebut.getTime() <= maintenant && (!l.dateFin || l.dateFin.getTime() > maintenant),
      createdAt: l.createdAt,
    }));
  }

  async creer(user: AuthenticatedUser, dto: CreerAnnonceDto) {
    const ctx = await this.contexteGestion(user);
    let organisationId: string | null;
    if (ctx.superadmin) {
      if (dto.toutesLesPages) organisationId = null;
      else if (dto.organisationId) {
        const org = await this.prisma.organisation.findFirst({ where: { id: dto.organisationId, deletedAt: null }, select: { id: true } });
        if (!org) throw new NotFoundException('Société introuvable.');
        organisationId = org.id;
      } else {
        throw new BadRequestException('Choisissez la société visée, ou « toutes les pages d’accueil ».');
      }
    } else {
      if (dto.toutesLesPages || (dto.organisationId && dto.organisationId !== ctx.organisationId)) {
        throw new ForbiddenException('Vous ne pouvez diffuser que sur la page d’accueil de votre société.');
      }
      organisationId = ctx.organisationId;
    }
    const debut = dto.dateDebut ? new Date(dto.dateDebut) : new Date();
    const fin = dto.dateFin ? new Date(dto.dateFin) : null;
    if (fin && fin <= debut) throw new BadRequestException('La date de fin doit suivre la date de début.');

    return this.prisma.$transaction(async (tx) => {
      const annonce = await tx.annonceBandeau.create({
        data: {
          organisationId,
          texte: dto.texte.trim(),
          dureeAffichageSecondes: dto.dureeAffichageSecondes ?? 30,
          dateDebut: debut,
          dateFin: fin,
          actif: dto.actif ?? true,
          creePar: ctx.userId,
        },
      });
      await this.audit(tx, ctx.userId, 'CREATION_ANNONCE_BANDEAU', annonce.id, { portee: organisationId ?? 'TOUTES', texte: annonce.texte });
      return annonce;
    });
  }

  async modifier(user: AuthenticatedUser, id: string, dto: ModifierAnnonceDto) {
    const ctx = await this.contexteGestion(user);
    const actuelle = await this.charger(ctx, id);
    const debut = dto.dateDebut ? new Date(dto.dateDebut) : actuelle.dateDebut;
    const fin = dto.dateFin === undefined ? actuelle.dateFin : dto.dateFin === null ? null : new Date(dto.dateFin);
    if (fin && fin <= debut) throw new BadRequestException('La date de fin doit suivre la date de début.');
    const data: Prisma.AnnonceBandeauUpdateInput = {
      ...(dto.texte !== undefined ? { texte: dto.texte.trim() } : {}),
      ...(dto.dureeAffichageSecondes !== undefined ? { dureeAffichageSecondes: dto.dureeAffichageSecondes } : {}),
      ...(dto.actif !== undefined ? { actif: dto.actif } : {}),
      dateDebut: debut,
      dateFin: fin,
    };
    return this.prisma.$transaction(async (tx) => {
      const maj = await tx.annonceBandeau.update({ where: { id }, data });
      await this.audit(tx, ctx.userId, 'MODIFICATION_ANNONCE_BANDEAU', id, { champs: Object.keys(dto) });
      return maj;
    });
  }

  /** Suppression logique : l'annonce n'est plus servie ni listée. */
  async supprimer(user: AuthenticatedUser, id: string): Promise<void> {
    const ctx = await this.contexteGestion(user);
    await this.charger(ctx, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.annonceBandeau.update({ where: { id }, data: { deletedAt: new Date(), actif: false } });
      await this.audit(tx, ctx.userId, 'SUPPRESSION_ANNONCE_BANDEAU', id, null);
    });
  }

  // --- Aides -------------------------------------------------------------

  private async contexteGestion(user: AuthenticatedUser) {
    const { profil } = await this.identity.getMe(user);
    const superadmin = !!profil.role && ROLES_SUPERADMIN.includes(profil.role);
    if (!superadmin && profil.role !== ROLE_GESTION_ANNONCES) {
      throw new ForbiddenException('Le bandeau d’annonces est géré par l’Assurance Informatique de la société et par le superadmin.');
    }
    if (!superadmin && !profil.organisationId) throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    return { userId: profil.id, organisationId: profil.organisationId ?? '', superadmin };
  }

  private async charger(ctx: { organisationId: string; superadmin: boolean }, id: string) {
    const a = await this.prisma.annonceBandeau.findFirst({
      where: { id, deletedAt: null, ...(ctx.superadmin ? {} : { organisationId: ctx.organisationId }) },
    });
    if (!a) throw new NotFoundException('Annonce introuvable.');
    return a;
  }

  private async audit(db: Prisma.TransactionClient, userId: string, action: string, id: string, details: object | null): Promise<void> {
    await db.$executeRaw`
      SELECT log_audit(
        ${action}::text,
        ${'annonces_bandeau'}::text,
        ${id}::uuid,
        ${userId}::uuid,
        ${details === null ? null : JSON.stringify(details)}::jsonb
      )`;
  }
}
