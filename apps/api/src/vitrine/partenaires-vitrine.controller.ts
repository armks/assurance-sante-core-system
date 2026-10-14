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
import { CreerPartenaireDto, ModifierPartenaireDto } from './dto/partenaire.dto';
import type { FichierImage } from './evenements.service';
import { PartenairesVitrineService, TAILLE_MAX_LOGO_PARTENAIRE } from './partenaires-vitrine.service';

/** Multer : au-delà de 5 Mo, rejet avant même la lecture complète (413). */
const LOGO = FileInterceptor('image', { limits: { fileSize: TAILLE_MAX_LOGO_PARTENAIRE, files: 1 } });

/**
 * Gestion des logos partenaires de la page d'accueil de SA société (authentifiée) :
 *   GET    /api/v1/vitrine/partenaires        liste de l'organisation
 *   POST   /api/v1/vitrine/partenaires        ajout (multipart : nom, siteUrl?, ordreAffichage?, actif?, image = logo)
 *   PATCH  /api/v1/vitrine/partenaires/:id    modification (logo facultatif)
 *   DELETE /api/v1/vitrine/partenaires/:id    suppression logique
 * Réservé à ASSUREUR_INFORMATIQUE (vérifié dans PartenairesVitrineService, + RLS). Lecture publique : `GET /api/v1/public/partenaires`.
 */
@Controller('vitrine/partenaires')
@UseGuards(SupabaseAuthGuard)
export class PartenairesVitrineController {
  constructor(private readonly partenaires: PartenairesVitrineService) {}

  @Get()
  lister(@CurrentUser() user: AuthenticatedUser) {
    return this.partenaires.lister(user);
  }

  @Post()
  @UseInterceptors(LOGO)
  creer(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreerPartenaireDto, @UploadedFile() image: FichierImage | undefined) {
    return this.partenaires.creer(user, dto, image);
  }

  @Patch(':id')
  @UseInterceptors(LOGO)
  modifier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModifierPartenaireDto,
    @UploadedFile() image: FichierImage | undefined,
  ) {
    return this.partenaires.modifier(user, id, dto, image);
  }

  @Delete(':id')
  supprimer(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.partenaires.supprimer(user, id);
  }
}
