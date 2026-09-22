import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ContestationService, type FichierTeleverse } from './contestation.service';
import { OuvrirContestationDto, TrancherContestationDto } from './dto/contestation.dto';

/**
 * Endpoints REST du module contestation/ — accès en revue du pharmacien
 * conseil sur les prescriptions, et mécanisme de contestation d'une ligne
 * d'ordonnance déjà servie.
 */
@Controller('contestation')
@UseGuards(SupabaseAuthGuard)
export class ContestationController {
  constructor(private readonly contestation: ContestationService) {}

  /** Côté PHARMACIEN CONSEIL : « Prescriptions à examiner ». */
  @Get('ordonnances-a-examiner')
  listerOrdonnancesPourRevue(@CurrentUser() user: AuthenticatedUser) {
    return this.contestation.listerOrdonnancesPourRevue(user);
  }

  /** Côté PHARMACIEN CONSEIL : « Contestations en cours ». Côté PHARMACIE : « Contestations reçues ». */
  @Get('contestations')
  listerContestations(@CurrentUser() user: AuthenticatedUser) {
    return this.contestation.listerContestations(user);
  }

  @Get('contestations/:id/pieces/:nomFichier')
  obtenirUrlPiece(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('nomFichier') nomFichier: string,
  ) {
    return this.contestation.obtenirUrlPiece(user, id, nomFichier);
  }

  /** Réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_CONSEIL. */
  @Post('contestations')
  ouvrirContestation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OuvrirContestationDto,
  ) {
    return this.contestation.ouvrirContestation(user, dto);
  }

  /** Réservé à PHARMACIE_PHARMACIEN/PHARMACIE_COMPTABLE de la pharmacie concernée. */
  @Post('contestations/:id/justification')
  @UseInterceptors(FilesInterceptor('pieces', 5))
  soumettreJustification(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reponse') reponse: string,
    @UploadedFiles() fichiers: FichierTeleverse[],
  ) {
    if (typeof reponse !== 'string') {
      throw new BadRequestException('Le champ "reponse" est requis.');
    }
    return this.contestation.soumettreJustification(user, id, reponse, fichiers ?? []);
  }

  /** Réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_CONSEIL. */
  @Post('contestations/:id/trancher')
  trancherContestation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TrancherContestationDto,
  ) {
    return this.contestation.trancherContestation(user, id, dto);
  }
}
