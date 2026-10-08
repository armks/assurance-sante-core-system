import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CreerEvenementDto, ModifierEvenementDto, ModifierHeroDto } from './dto/evenement.dto';
import { EvenementsService, TAILLE_MAX_IMAGE_EVENEMENT, type FichierImage } from './evenements.service';

/** Multer : au-delà de 5 Mo, rejet avant même la lecture complète (413). */
const IMAGE = FileInterceptor('image', { limits: { fileSize: TAILLE_MAX_IMAGE_EVENEMENT, files: 1 } });

/**
 * Gestion des événements de la vitrine (authentifiée) :
 *   GET    /api/v1/vitrine/evenements        liste de l'organisation
 *   POST   /api/v1/vitrine/evenements        création (multipart, image requise)
 *   PATCH  /api/v1/vitrine/evenements/:id    modification (image facultative)
 *   DELETE /api/v1/vitrine/evenements/:id    suppression logique
 *   GET / PATCH /api/v1/vitrine/hero         bannière de la page /{slug} de la société
 * Réservé à ASSUREUR_INFORMATIQUE (vérifié dans EvenementsService, + RLS).
 * La lecture publique est `GET /api/v1/public/evenements` (VitrineController).
 */
@Controller('vitrine')
@UseGuards(SupabaseAuthGuard)
export class EvenementsController {
  constructor(private readonly evenements: EvenementsService) {}

  /** Bannière de la page /{slug} de SA société (GET / PATCH multipart, champ `image`). */
  @Get('hero')
  obtenirHero(@CurrentUser() user: AuthenticatedUser) {
    return this.evenements.obtenirHero(user);
  }

  @Patch('hero')
  @UseInterceptors(IMAGE)
  modifierHero(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ModifierHeroDto,
    @UploadedFile() image: FichierImage | undefined,
  ) {
    return this.evenements.modifierHero(user, dto, image);
  }

  @Get('evenements')
  listerEvenements(@CurrentUser() user: AuthenticatedUser) {
    return this.evenements.lister(user);
  }

  @Post('evenements')
  @UseInterceptors(IMAGE)
  creerEvenement(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreerEvenementDto,
    @UploadedFile() image: FichierImage | undefined,
  ) {
    return this.evenements.creer(user, dto, image);
  }

  @Patch('evenements/:id')
  @UseInterceptors(IMAGE)
  modifierEvenement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModifierEvenementDto,
    @UploadedFile() image: FichierImage | undefined,
  ) {
    return this.evenements.modifier(user, id, dto, image);
  }

  /** Masqué de la page publique (archivage, ADR-007). */
  @Post('evenements/:id/archiver')
  archiverEvenement(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.evenements.changerVisibilite(user, id, 'archiver');
  }

  /** Affiché de nouveau (désarchivage). */
  @Post('evenements/:id/desarchiver')
  desarchiverEvenement(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.evenements.changerVisibilite(user, id, 'desarchiver');
  }

  @Delete('evenements/:id')
  supprimerEvenement(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.evenements.supprimer(user, id);
  }
}
