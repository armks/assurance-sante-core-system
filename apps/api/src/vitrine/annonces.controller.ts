import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AnnoncesService } from './annonces.service';
import { CreerAnnonceDto, ModifierAnnonceDto } from './dto/annonce.dto';

/**
 * Gestion des annonces du bandeau défilant (authentifiée) :
 *   GET    /api/v1/vitrine/annonces        liste (celles de la société, ou toutes pour le superadmin)
 *   POST   /api/v1/vitrine/annonces        création
 *   PATCH  /api/v1/vitrine/annonces/:id    modification
 *   DELETE /api/v1/vitrine/annonces/:id    suppression logique
 * Réservé à ASSUREUR_INFORMATIQUE (sa société) et au superadmin (toutes, ou toute la plateforme). La lecture publique est
 * `GET /api/v1/public/annonces` (VitrineController).
 */
@Controller('vitrine/annonces')
@UseGuards(SupabaseAuthGuard)
export class AnnoncesController {
  constructor(private readonly annonces: AnnoncesService) {}

  @Get()
  lister(@CurrentUser() user: AuthenticatedUser) {
    return this.annonces.lister(user);
  }

  @Post()
  creer(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreerAnnonceDto) {
    return this.annonces.creer(user, dto);
  }

  @Patch(':id')
  modifier(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ModifierAnnonceDto) {
    return this.annonces.modifier(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  supprimer(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.annonces.supprimer(user, id);
  }
}
