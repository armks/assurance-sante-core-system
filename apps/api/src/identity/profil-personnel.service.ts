import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { PrismaService } from '../prisma/prisma.service';

const BUCKET_PHOTOS = 'photos';
const TAILLE_MAX_PHOTO_OCTETS = 5 * 1024 * 1024;
const FORMATS_PHOTO: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const FORMAT_PSEUDO = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{1,29}$/u;

/** Fichier reçu par `FileInterceptor` (multer, stockage mémoire). */
export interface FichierPhotoProfil {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Profil personnel de l'utilisateur connecté : son pseudo et sa photo (chacun ne modifie que les siens).
 * Photo dans le bucket privé `photos` (chemin `profils/{id}/…`), lue par URL signée courte durée.
 */
@Injectable()
export class ProfilPersonnelService {
  private readonly logger = new Logger(ProfilPersonnelService.name);

  constructor(private readonly prisma: PrismaService) {}

  async modifierPseudo(user: AuthenticatedUser, pseudo: string | undefined) {
    const valeur = pseudo?.trim() || null;
    const profil = await this.prisma.profil.findFirst({ where: { id: user.sub, deletedAt: null }, select: { organisationId: true } });
    if (!profil) throw new NotFoundException('Profil introuvable.');
    if (valeur !== null) {
      if (!FORMAT_PSEUDO.test(valeur)) {
        throw new BadRequestException('Le pseudo compte 2 à 30 caractères : lettres, chiffres, espace, point, tiret, tiret bas ou apostrophe.');
      }
      // un pseudo identifie une personne dans les traces : unique (sans tenir compte de la casse) dans l'organisation
      const pris = await this.prisma.profil.findFirst({
        where: { organisationId: profil.organisationId, pseudo: { equals: valeur, mode: 'insensitive' }, id: { not: user.sub }, deletedAt: null },
        select: { id: true },
      });
      if (pris) throw new ConflictException('Ce pseudo est déjà utilisé dans votre organisation.');
    }
    await this.prisma.profil.update({ where: { id: user.sub }, data: { pseudo: valeur } });
    return { pseudo: valeur };
  }

  async televerserPhoto(user: AuthenticatedUser, fichier: FichierPhotoProfil | undefined) {
    if (!fichier?.buffer) throw new BadRequestException('Aucun fichier reçu (champ « photo »).');
    const extension = FORMATS_PHOTO[fichier.mimetype];
    if (!extension) throw new BadRequestException('Formats de photo acceptés : JPEG, PNG, WEBP.');
    if (fichier.size > TAILLE_MAX_PHOTO_OCTETS) throw new BadRequestException('Photo trop volumineuse (max 5 Mo).');
    const profil = await this.prisma.profil.findFirst({ where: { id: user.sub, deletedAt: null }, select: { photoUrl: true } });
    if (!profil) throw new NotFoundException('Profil introuvable.');

    const chemin = `profils/${user.sub}/photo-${Date.now()}.${extension}`;
    await this.televerser(chemin, fichier);
    await this.prisma.profil.update({ where: { id: user.sub }, data: { photoUrl: chemin } });
    // ancienne photo : supprimée APRÈS la mise à jour (jamais un profil pointant vers un objet absent)
    if (profil.photoUrl) await this.supprimerObjet(profil.photoUrl);
    return { url: await this.signer(chemin) };
  }

  async supprimerPhoto(user: AuthenticatedUser) {
    const profil = await this.prisma.profil.findFirst({ where: { id: user.sub, deletedAt: null }, select: { photoUrl: true } });
    if (!profil) throw new NotFoundException('Profil introuvable.');
    if (!profil.photoUrl) return { supprimee: false };
    await this.prisma.profil.update({ where: { id: user.sub }, data: { photoUrl: null } });
    await this.supprimerObjet(profil.photoUrl);
    return { supprimee: true };
  }

  async urlPhoto(user: AuthenticatedUser) {
    const profil = await this.prisma.profil.findFirst({ where: { id: user.sub, deletedAt: null }, select: { photoUrl: true } });
    if (!profil?.photoUrl) throw new NotFoundException('Aucune photo pour ce compte.');
    return { url: await this.signer(profil.photoUrl) };
  }

  private get baseStorage(): string {
    return `${(process.env.SUPABASE_URL ?? '').replace(/\/$/, '')}/storage/v1`;
  }

  private get cle(): string {
    return process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  }

  private assertStockage(): void {
    if (!process.env.SUPABASE_URL || !this.cle) {
      throw new ServiceUnavailableException('Stockage des photos indisponible : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.');
    }
  }

  private async televerser(chemin: string, fichier: FichierPhotoProfil): Promise<void> {
    this.assertStockage();
    const res = await fetch(`${this.baseStorage}/object/${BUCKET_PHOTOS}/${chemin}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cle}`, apikey: this.cle, 'Content-Type': fichier.mimetype, 'x-upsert': 'true' },
      body: fichier.buffer as unknown as BodyInit,
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`Téléversement de la photo refusé (${res.status} : ${(await res.text()).slice(0, 200)}).`);
    }
  }

  private async signer(chemin: string): Promise<string> {
    this.assertStockage();
    const res = await fetch(`${this.baseStorage}/object/sign/${BUCKET_PHOTOS}/${chemin}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cle}`, apikey: this.cle, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!res.ok) throw new ServiceUnavailableException(`Signature de la photo refusée (${res.status}).`);
    const corps = (await res.json()) as { signedURL?: string; signedUrl?: string };
    const rel = corps.signedURL ?? corps.signedUrl;
    if (!rel) throw new ServiceUnavailableException('Signature de la photo : réponse inattendue.');
    return `${this.baseStorage}${rel.startsWith('/') ? '' : '/'}${rel}`;
  }

  private async supprimerObjet(chemin: string): Promise<void> {
    try {
      const res = await fetch(`${this.baseStorage}/object/${BUCKET_PHOTOS}/${chemin}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.cle}`, apikey: this.cle },
      });
      if (!res.ok) this.logger.warn(`Ancienne photo non supprimée (${chemin}) : ${res.status}`);
    } catch (e) {
      this.logger.warn(`Ancienne photo non supprimée (${chemin}) : ${e instanceof Error ? e.message : e}`);
    }
  }
}
