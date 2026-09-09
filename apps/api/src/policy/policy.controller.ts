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
  ChangerStatutDto,
  CreateAvenantDto,
  CreateDevisDto,
  SouscrireDto,
} from './dto/policy.dto';
import { PolicyService } from './policy.service';

/**
 * Endpoints REST du module policy — polices (machine à états) + avenants.
 * Lecture scopée (personnel ASSUREUR de l'org OU le souscripteur concerné) ;
 * écriture réservée aux rôles ASSUREUR habilités (vérifié dans PolicyService,
 * en plus de la RLS Postgres).
 */
@Controller('policy/polices')
@UseGuards(SupabaseAuthGuard)
export class PolicyController {
  constructor(private readonly policy: PolicyService) {}

  @Post()
  creerDevis(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDevisDto,
  ) {
    return this.policy.creerDevis(user, dto);
  }

  @Get()
  lister(
    @CurrentUser() user: AuthenticatedUser,
    @Query('statut') statut?: string,
    @Query('souscripteurId') souscripteurId?: string,
  ) {
    return this.policy.listerPolices(user, { statut, souscripteurId });
  }

  @Get(':id')
  obtenir(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.policy.obtenirPolice(user, id);
  }

  @Post(':id/souscrire')
  souscrire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SouscrireDto,
  ) {
    return this.policy.souscrire(user, id, dto);
  }

  @Post(':id/statut')
  changerStatut(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangerStatutDto,
  ) {
    return this.policy.changerStatut(user, id, dto.statut);
  }

  @Get(':id/avenants')
  listerAvenants(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.policy.listerAvenants(user, id);
  }

  @Post(':id/avenants')
  creerAvenant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAvenantDto,
  ) {
    return this.policy.creerAvenant(user, id, dto);
  }

  @Post(':id/avenants/:avenantId/appliquer')
  appliquerAvenant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('avenantId', ParseUUIDPipe) avenantId: string,
  ) {
    return this.policy.appliquerAvenant(user, id, avenantId);
  }

  @Post(':id/avenants/:avenantId/annuler')
  annulerAvenant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('avenantId', ParseUUIDPipe) avenantId: string,
  ) {
    return this.policy.annulerAvenant(user, id, avenantId);
  }
}
