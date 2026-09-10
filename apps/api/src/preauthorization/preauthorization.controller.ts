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
import { AjouterActeDto } from './dto/acte.dto';
import { ValiderCodeFacturationDto } from './dto/facture.dto';
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

  // --- Ticket de Soins (v8 §4) -------------------------------------
  // Le ticket est créé / clôturé AUTOMATIQUEMENT avec le dossier de soins ;
  // il n'existe pas de route pour le créer ou le clôturer manuellement.

  @Get('tickets-soins/:id')
  obtenirTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.preauth.obtenirTicket(user, id);
  }

  @Post('tickets-soins/:id/actes')
  ajouterActe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AjouterActeDto,
  ) {
    return this.preauth.ajouterActe(user, id, dto);
  }

  // --- Code de Facturation (v8 §5) — 4e et dernier code anti-fraude ---

  /** Côté ASSUREUR : génère la facture d'un ticket CLÔTURÉ (+ le code, non renvoyé ici). */
  @Post('tickets-soins/:id/facture')
  genererFacture(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.preauth.genererFacture(user, id);
  }

  /** Côté ADHÉRENT : ses factures, avec le code de facturation et la synthèse. */
  @Get('codes-facturation')
  mesFactures(@CurrentUser() user: AuthenticatedUser) {
    return this.preauth.listerMesFactures(user);
  }

  /** Côté ADHÉRENT : valide le code de facturation (condition du règlement). */
  @Post('codes-facturation/valider')
  validerFacturation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ValiderCodeFacturationDto,
  ) {
    return this.preauth.validerCodeFacturation(user, dto);
  }

  @Get('factures/:id')
  obtenirFacture(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.preauth.obtenirFacture(user, id);
  }

  /** Côté ASSUREUR_COMPTABLE : confirme le paiement — bloqué si code non validé. */
  @Post('factures/:id/confirmer-paiement')
  confirmerPaiement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.preauth.confirmerPaiement(user, id);
  }
}
