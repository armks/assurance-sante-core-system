import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ContestationService, type FichierTeleverse } from './contestation.service';
import {
  OuvrirContestationActeDto,
  OuvrirContestationDto,
  RevueActesQueryDto,
  RevueQueryDto,
  TrancherContestationDto,
} from './dto/contestation.dto';

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
  listerOrdonnancesPourRevue(@CurrentUser() user: AuthenticatedUser, @Query() dto: RevueQueryDto) {
    return this.contestation.listerOrdonnancesPourRevue(user, dto);
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

  // --- Contestation d'un acte/hospitalisation/analyse-examen ---------

  /** Côté MÉDECIN CONSEIL : « Actes à examiner ». */
  @Get('actes-a-examiner')
  listerActesPourRevue(@CurrentUser() user: AuthenticatedUser, @Query() dto: RevueActesQueryDto) {
    return this.contestation.listerActesPourRevue(user, dto);
  }

  /** Côté MÉDECIN CONSEIL : « Contestations en cours ». Côté ÉTABLISSEMENT : « Contestations reçues ». */
  @Get('contestations-actes')
  listerContestationsActes(@CurrentUser() user: AuthenticatedUser) {
    return this.contestation.listerContestationsActes(user);
  }

  @Get('contestations-actes/:id/pieces/:nomFichier')
  obtenirUrlPieceActe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('nomFichier') nomFichier: string,
  ) {
    return this.contestation.obtenirUrlPieceActe(user, id, nomFichier);
  }

  /** Réservé EXCLUSIVEMENT à ASSUREUR_MEDECIN_CONSEIL. */
  @Post('contestations-actes')
  ouvrirContestationActe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OuvrirContestationActeDto,
  ) {
    return this.contestation.ouvrirContestationActe(user, dto);
  }

  /** Réservé à CENTRE_MEDICAL_MEDECIN/COMPTABLE/ADMINISTRATIF de l'établissement concerné. */
  @Post('contestations-actes/:id/justification')
  @UseInterceptors(FilesInterceptor('pieces', 5))
  soumettreJustificationActe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reponse') reponse: string,
    @UploadedFiles() fichiers: FichierTeleverse[],
  ) {
    if (typeof reponse !== 'string') {
      throw new BadRequestException('Le champ "reponse" est requis.');
    }
    return this.contestation.soumettreJustificationActe(user, id, reponse, fichiers ?? []);
  }

  /** Réservé EXCLUSIVEMENT à ASSUREUR_MEDECIN_CONSEIL. */
  @Post('contestations-actes/:id/trancher')
  trancherContestationActe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TrancherContestationDto,
  ) {
    return this.contestation.trancherContestationActe(user, id, dto);
  }
}
