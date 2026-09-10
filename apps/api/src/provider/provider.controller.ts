import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  CreateEtablissementDto,
  CreatePharmacieDto,
  EnregistrerVerificationDto,
  RechercheGeoDto,
  ReverifierObsoletesDto,
  UpdateEtablissementDto,
  UpdatePharmacieDto,
} from './dto/provider.dto';
import { ProviderService } from './provider.service';

/**
 * Endpoints REST du module provider — réseau de soins. Lecture ouverte à toute
 * personne de l'organisation ; écriture réservée à ASSUREUR_INFORMATIQUE
 * (vérifié dans ProviderService, en plus de la RLS Postgres).
 */
@Controller('provider')
@UseGuards(SupabaseAuthGuard)
export class ProviderController {
  constructor(private readonly provider: ProviderService) {}

  // --- Recherche géolocalisée (avant les routes :id) ----------------

  @Get('recherche')
  recherche(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: RechercheGeoDto,
  ) {
    return this.provider.rechercheGeolocalisee(user, dto);
  }

  // --- Établissements ---------------------------------------------

  @Post('etablissements')
  creerEtablissement(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEtablissementDto,
  ) {
    return this.provider.creerEtablissement(user, dto);
  }

  @Get('etablissements')
  listerEtablissements(
    @CurrentUser() user: AuthenticatedUser,
    @Query('type') type?: string,
    @Query('statut') statut?: string,
    @Query('ville') ville?: string,
  ) {
    return this.provider.listerEtablissements(user, { type, statut, ville });
  }

  @Get('etablissements/:id')
  obtenirEtablissement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.provider.obtenirEtablissement(user, id);
  }

  @Patch('etablissements/:id')
  modifierEtablissement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEtablissementDto,
  ) {
    return this.provider.modifierEtablissement(user, id, dto);
  }

  @Delete('etablissements/:id')
  @HttpCode(204)
  supprimerEtablissement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.provider.supprimerEtablissement(user, id);
  }

  @Post('etablissements/:id/verifications')
  verifierEtablissement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnregistrerVerificationDto,
  ) {
    return this.provider.enregistrerVerification(user, 'etablissement', id, dto);
  }

  @Get('etablissements/:id/verifications')
  listerVerificationsEtablissement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.provider.listerVerifications(user, 'etablissement', id);
  }

  // --- Pharmacies -----------------------------------------------

  @Post('pharmacies')
  creerPharmacie(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePharmacieDto,
  ) {
    return this.provider.creerPharmacie(user, dto);
  }

  @Get('pharmacies')
  listerPharmacies(
    @CurrentUser() user: AuthenticatedUser,
    @Query('statut') statut?: string,
    @Query('ville') ville?: string,
  ) {
    return this.provider.listerPharmacies(user, { statut, ville });
  }

  @Get('pharmacies/:id')
  obtenirPharmacie(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.provider.obtenirPharmacie(user, id);
  }

  @Patch('pharmacies/:id')
  modifierPharmacie(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePharmacieDto,
  ) {
    return this.provider.modifierPharmacie(user, id, dto);
  }

  @Delete('pharmacies/:id')
  @HttpCode(204)
  supprimerPharmacie(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.provider.supprimerPharmacie(user, id);
  }

  @Post('pharmacies/:id/verifications')
  verifierPharmacie(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnregistrerVerificationDto,
  ) {
    return this.provider.enregistrerVerification(user, 'pharmacie', id, dto);
  }

  @Get('pharmacies/:id/verifications')
  listerVerificationsPharmacie(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.provider.listerVerifications(user, 'pharmacie', id);
  }

  // --- Tâche planifiée (déclenchée à la main) ---------------------

  @Post('verifications/reverifier-obsoletes')
  reverifierObsoletes(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReverifierObsoletesDto,
  ) {
    return this.provider.reverifierObsoletes(user, dto);
  }
}
