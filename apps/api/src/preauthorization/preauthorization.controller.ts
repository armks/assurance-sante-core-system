import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  CreerOrdonnanceDto,
  DispensationDto,
  ValiderCodeOrdonnanceDto,
} from './dto/ordonnance.dto';
import {
  GenererCodeConsultationDto,
  ValiderCodeConsultationDto,
} from './dto/preauthorization.dto';
import { PreauthorizationService } from './preauthorization.service';

/**
 * Endpoints REST du module preauthorization — Code de Consultation (v8 §2).
 *
 * `codes-consultation` (POST/GET/confirmer/annuler) : côté ADHÉRENT.
 * `codes-consultation/valider` : côté ÉTABLISSEMENT — c'est la SEULE voie
 * d'ouverture d'un dossier de soins.
 */
@Controller('preauthorization')
@UseGuards(SupabaseAuthGuard)
export class PreauthorizationController {
  constructor(private readonly preauth: PreauthorizationService) {}

  @Post('codes-consultation')
  generer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenererCodeConsultationDto,
  ) {
    return this.preauth.genererCodeConsultation(user, dto);
  }

  @Get('codes-consultation')
  listerMesCodes(@CurrentUser() user: AuthenticatedUser) {
    return this.preauth.listerMesCodes(user);
  }

  @Post('codes-consultation/valider')
  valider(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ValiderCodeConsultationDto,
  ) {
    return this.preauth.validerCodeConsultation(user, dto);
  }

  @Post('codes-consultation/:id/confirmer')
  confirmer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.preauth.confirmerPresence(user, id);
  }

  @Post('codes-consultation/:id/annuler')
  annuler(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.preauth.annulerCode(user, id);
  }

  // --- Code Référence d'Ordonnance (v8 §3) --------------------------

  /** Côté MÉDECIN : établit l'ordonnance + génère le code (non renvoyé ici). */
  @Post('ordonnances')
  creerOrdonnance(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreerOrdonnanceDto,
  ) {
    return this.preauth.creerOrdonnance(user, dto);
  }

  /** Côté ADHÉRENT : ses codes d'ordonnance (avec la valeur du code). */
  @Get('codes-ordonnance')
  mesCodesOrdonnance(@CurrentUser() user: AuthenticatedUser) {
    return this.preauth.listerMesCodesOrdonnance(user);
  }

  /** Côté PHARMACIE : saisie du code → révèle le contenu de l'ordonnance. */
  @Post('codes-ordonnance/valider')
  validerOrdonnance(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ValiderCodeOrdonnanceDto,
  ) {
    return this.preauth.validerCodeOrdonnance(user, dto);
  }

  /** Côté PHARMACIE : dispensation partielle ou complète, après coup. */
  @Post('codes-ordonnance/:id/dispensation')
  dispensation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DispensationDto,
  ) {
    return this.preauth.marquerDispensation(user, id, dto);
  }
}
