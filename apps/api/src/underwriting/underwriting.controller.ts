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
import {
  CalculerPrimeDto,
  EvaluerQuestionnaireDto,
  SoumettreQuestionnaireDto,
} from './dto/underwriting.dto';
import { UnderwritingService } from './underwriting.service';

/**
 * Endpoints REST du module underwriting — questionnaire médical + tarification
 * individuelle. La décision est réservée à ASSUREUR_MEDECIN_SOUSCRIPTEUR ;
 * ASSUREUR_MEDECIN_CONSEIL n'a aucun accès (vérifié dans UnderwritingService
 * en plus de la RLS Postgres).
 */
@Controller('underwriting')
@UseGuards(SupabaseAuthGuard)
export class UnderwritingController {
  constructor(private readonly underwriting: UnderwritingService) {}

  @Post('questionnaires')
  soumettre(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SoumettreQuestionnaireDto,
  ) {
    return this.underwriting.soumettreQuestionnaire(user, dto);
  }

  @Get('questionnaires')
  lister(
    @CurrentUser() user: AuthenticatedUser,
    @Query('decision') decision?: string,
    @Query('souscripteurId') souscripteurId?: string,
  ) {
    return this.underwriting.listerQuestionnaires(user, {
      decision,
      souscripteurId,
    });
  }

  @Get('questionnaires/:id')
  obtenir(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.underwriting.obtenirQuestionnaire(user, id);
  }

  @Post('questionnaires/:id/evaluer')
  evaluer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EvaluerQuestionnaireDto,
  ) {
    return this.underwriting.evaluerQuestionnaire(user, id, dto);
  }

  @Get('tarifications')
  listerTarifications(@CurrentUser() user: AuthenticatedUser) {
    return this.underwriting.listerTarifications(user);
  }

  @Post('tarifications')
  calculerPrime(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CalculerPrimeDto,
  ) {
    return this.underwriting.calculerPrime(user, dto);
  }
}
