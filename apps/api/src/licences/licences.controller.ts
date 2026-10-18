import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ActiverLicenceDto, EmailSocieteDto, EnvoyerCodeDto, HistoriqueLicencesQueryDto, PrixLicenceDto, TypeLicenceDto } from './licences.dto';
import type { TypeLicence } from './licence-etat';
import { LicencesService } from './licences.service';

/** Licence de ma société : consultation (échéance, temps restant) et activation par code — informatique et direction de l'assureur. */
@Controller('licences')
@UseGuards(SupabaseAuthGuard)
export class LicencesController {
  constructor(private readonly licences: LicencesService) {}

  @Get('statut')
  statut(@CurrentUser() user: AuthenticatedUser) {
    return this.licences.statut(user);
  }

  // anti force brute sur le code d'activation
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('activer')
  activer(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActiverLicenceDto) {
    return this.licences.activer(user, dto.code);
  }
}

/** Gestion des licences par le superadmin : état de toutes les sociétés, code d'activation, activation directe, alerte d'expiration. */
@Controller('superadmin/licences')
@UseGuards(SupabaseAuthGuard)
export class LicencesSuperadminController {
  constructor(private readonly licences: LicencesService) {}

  @Get()
  lister(@CurrentUser() user: AuthenticatedUser) {
    return this.licences.lister(user);
  }

  @Get('types')
  types(@CurrentUser() user: AuthenticatedUser) {
    return this.licences.types(user);
  }

  /** Historique des licences générées (avec prix), filtrable, et cumuls. */
  @Get('historique')
  historique(@CurrentUser() user: AuthenticatedUser, @Query() filtres: HistoriqueLicencesQueryDto) {
    return this.licences.historique(user, filtres);
  }

  /** Grille de prix des licences. */
  @Get('tarifs')
  tarifs(@CurrentUser() user: AuthenticatedUser) {
    return this.licences.tarifs(user);
  }

  /** Modifie le prix d'un type de licence (vaut pour les licences générées ensuite). */
  @Put('tarifs/:type')
  definirTarif(
    @CurrentUser() user: AuthenticatedUser,
    @Param('type', new ParseEnumPipe(['ESSAI', 'MENSUELLE', 'TRIMESTRIELLE', 'SEMESTRIELLE', 'ANNUELLE', 'BIENNALE'])) type: TypeLicence,
    @Body() dto: PrixLicenceDto,
  ) {
    return this.licences.definirTarif(user, type, dto.prix);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':organisationId/code')
  genererCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: TypeLicenceDto,
  ) {
    return this.licences.genererCode(user, organisationId, dto.typeLicence);
  }

  /** Envoie le code d'activation en attente à l'adresse de la société d'assurance ou à son directeur. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':organisationId/code/envoyer')
  envoyerCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: EnvoyerCodeDto,
  ) {
    return this.licences.envoyerCode(user, organisationId, dto.cible);
  }

  @Patch(':organisationId/email-societe')
  definirEmailSociete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: EmailSocieteDto,
  ) {
    return this.licences.definirEmailSociete(user, organisationId, dto.email);
  }

  @Post(':organisationId/activation-directe')
  activerDirectement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: TypeLicenceDto,
  ) {
    return this.licences.activerDirectement(user, organisationId, dto.typeLicence);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':organisationId/alerte-expiration')
  alerte(@CurrentUser() user: AuthenticatedUser, @Param('organisationId', ParseUUIDPipe) organisationId: string) {
    return this.licences.envoyerAlerte(user, organisationId);
  }
}
