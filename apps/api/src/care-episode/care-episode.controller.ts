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
  AjouterNoteDto,
  ClotureDto,
  ClotureForceeDto,
  DefinirTypeVisiteDto,
  ListerDossiersQueryDto,
} from './dto/care-episode.dto';

/**
 * Endpoints REST du module care-episode — Dossier de Soins et Numéro de
 * Traitement (v1 §15).
 *
 * ⚠️ Il n'existe AUCUNE route d'ouverture de dossier : la seule voie de création
 * est `POST /api/v1/preauthorization/codes-consultation/valider` (v8 §2). Ce
 * contrôleur n'expose que la lecture, l'ajout de consultation et la clôture.
 */
@Controller('care-episode/dossiers')
@UseGuards(SupabaseAuthGuard)
export class CareEpisodeController {
  constructor(private readonly careEpisode: CareEpisodeService) {}

  @Get()
  lister(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListerDossiersQueryDto,
  ) {
    return this.careEpisode.listerDossiers(user, dto);
  }

  /** Chiffres agrégés (statuts, actes, coûts mensuels, établissements) pour les graphiques — déclarée AVANT `:id`. */
  @Get('statistiques')
  statistiques(@CurrentUser() user: AuthenticatedUser) {
    return this.careEpisode.statistiquesDossiers(user);
  }

  /**
   * Médecins de l'établissement de l'appelant — pour désigner le médecin d'une consultation ou celui qui a effectué un acte
   * (accueil). Déclarée AVANT `:id` : sinon « medecins » serait pris pour un identifiant.
   */
  @Get('medecins')
  medecins(@CurrentUser() user: AuthenticatedUser) {
    return this.careEpisode.listerMedecinsEtablissement(user);
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

  /** Choisi UNE FOIS, à l'intérieur du dossier, après son ouverture (409 si déjà défini). */
  @Post(':id/type-visite')
  definirTypeVisite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DefinirTypeVisiteDto,
  ) {
    return this.careEpisode.definirTypeVisite(user, id, dto);
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

  /**
   * Réservé à ASSUREUR_EXPLOITATION(_CONJOINTE)/ASSUREUR_MEDECIN_CONSEIL —
   * visible ensuite dans `GET :id` (`notes`) par tout rôle ayant déjà accès
   * en lecture au dossier.
   */
  @Post(':id/notes')
  ajouterNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AjouterNoteDto,
  ) {
    return this.careEpisode.ajouterNote(user, id, dto);
  }
}
