import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CareEpisodeService } from './care-episode.service';
import {
  AjouterConsultationDto,
  ClotureDto,
  ClotureForceeDto,
  OuvrirDossierDto,
} from './dto/care-episode.dto';

/**
 * Endpoints REST du module care-episode — Dossier de Soins et Numéro de
 * Traitement (v1 §15). Lecture ouverte à l'organisation ; ouverture / consultation
 * / clôture gardées dans CareEpisodeService (+ trigger et RLS Postgres).
 */
@Controller('care-episode/dossiers')
@UseGuards(SupabaseAuthGuard)
export class CareEpisodeController {
  constructor(private readonly careEpisode: CareEpisodeService) {}

  @Post()
  ouvrir(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OuvrirDossierDto,
  ) {
    return this.careEpisode.ouvrirDossier(user, dto);
  }

  @Get()
  lister(
    @CurrentUser() user: AuthenticatedUser,
    @Query('statut') statut?: string,
    @Query('etablissementId') etablissementId?: string,
  ) {
    return this.careEpisode.listerDossiers(user, { statut, etablissementId });
  }

  @Get(':id')
  obtenir(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.careEpisode.obtenirDossier(user, id);
  }

  @Post(':id/consultations')
  ajouterConsultation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AjouterConsultationDto,
  ) {
    return this.careEpisode.ajouterConsultation(user, id, dto);
  }

  @Post(':id/cloturer')
  cloturer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClotureDto,
  ) {
    return this.careEpisode.clotureNormale(user, id, dto);
  }

  @Post(':id/cloture-forcee')
  clotureForcee(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClotureForceeDto,
  ) {
    return this.careEpisode.clotureForcee(user, id, dto);
  }
}
