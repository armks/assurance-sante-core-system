import { Throttle } from '@nestjs/throttler';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  AccepterInvitationDto,
  CreerInvitationDto,
  RejeterInvitationDto,
} from './dto/invitations.dto';
import { InvitationsService } from './invitations.service';

/**
 * Endpoints REST du module `invitations/` (PROMPT 6).
 *
 * Routes authentifiées : création, listing, validation/rejet, révocation.
 * Routes PUBLIQUES : consultation par token et acceptation — l'invité n'a pas
 * encore de session Supabase à ce stade.
 */
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @UseGuards(SupabaseAuthGuard)
  creer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreerInvitationDto,
  ) {
    return this.invitations.creerInvitation(user, dto);
  }

  @Get()
  @UseGuards(SupabaseAuthGuard)
  lister(@CurrentUser() user: AuthenticatedUser) {
    return this.invitations.listerMesInvitations(user);
  }

  @Post(':id/valider')
  @UseGuards(SupabaseAuthGuard)
  valider(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invitations.validerProposition(user, id);
  }

  @Post(':id/rejeter')
  @UseGuards(SupabaseAuthGuard)
  rejeter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejeterInvitationDto,
  ) {
    return this.invitations.rejeterProposition(user, id, dto.motif);
  }

  @Post(':id/revoquer')
  @UseGuards(SupabaseAuthGuard)
  revoquer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invitations.revoquer(user, id);
  }

  /** Retente l'envoi réel de l'e-mail — un seul essai explicite, jamais de boucle. */
  @Post(':id/renvoyer')
  @UseGuards(SupabaseAuthGuard)
  renvoyer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invitations.renvoyerEmail(user, id);
  }

  // --- Public : parcours d'acceptation --------------------------------

  /** Nouvelle invitation depuis une invitation REVOQUEE ou EXPIREE (aucune suppression). */
  @Post(':id/renvoyer-nouvelle')
  @UseGuards(SupabaseAuthGuard)
  renvoyerNouvelle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invitations.renvoyerNouvelle(user, id);
  }

  @Get('token/:token')
  consulter(@Param('token') token: string) {
    return this.invitations.consulterParToken(token);
  }

  @Throttle({ default: { limit: 8, ttl: 60_000 } }) // anti force brute sur les codes
  @Post('accepter')
  @HttpCode(200)
  accepter(@Body() dto: AccepterInvitationDto) {
    return this.invitations.accepterInvitation(dto);
  }
}
