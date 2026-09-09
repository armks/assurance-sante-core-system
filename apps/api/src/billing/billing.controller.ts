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
import { BillingService } from './billing.service';
import {
  CalculerCotisationDto,
  CreateGrilleDto,
  EnregistrerPaiementDto,
  GenererCotisationsDto,
} from './dto/billing.dto';

/**
 * Endpoints REST du module billing — grilles tarifaires + cotisations.
 * Écriture réservée à ASSUREUR_COMPTABLE / ASSUREUR_INFORMATIQUE ; lecture des
 * cotisations élargie au souscripteur concerné (vérifié dans BillingService,
 * en plus de la RLS Postgres).
 */
@Controller('billing')
@UseGuards(SupabaseAuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // --- Grilles tarifaires ---
  @Post('grilles-tarifaires')
  creerGrille(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGrilleDto,
  ) {
    return this.billing.creerGrille(user, dto);
  }

  @Get('grilles-tarifaires')
  listerGrilles(
    @CurrentUser() user: AuthenticatedUser,
    @Query('produitId') produitId?: string,
    @Query('souscripteurId') souscripteurId?: string,
  ) {
    return this.billing.listerGrilles(user, { produitId, souscripteurId });
  }

  // --- Calcul (ne persiste rien) ---
  @Post('cotisations/calculer')
  calculer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CalculerCotisationDto,
  ) {
    return this.billing.calculerCotisation(user, dto);
  }

  // --- Tâche : passage EN_RETARD ---
  @Post('cotisations/marquer-en-retard')
  marquerEnRetard(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.marquerEnRetard(user);
  }

  // --- Cotisations ---
  @Get('cotisations')
  listerCotisations(
    @CurrentUser() user: AuthenticatedUser,
    @Query('statut') statut?: string,
    @Query('policeId') policeId?: string,
  ) {
    return this.billing.listerCotisations(user, { statut, policeId });
  }

  @Post('polices/:policeId/cotisations')
  genererCotisations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('policeId', ParseUUIDPipe) policeId: string,
    @Body() dto: GenererCotisationsDto,
  ) {
    return this.billing.genererCotisationsPeriode(user, policeId, dto);
  }

  @Get('polices/:policeId/cotisations')
  listerCotisationsPolice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('policeId', ParseUUIDPipe) policeId: string,
  ) {
    return this.billing.listerCotisationsPolice(user, policeId);
  }

  @Post('cotisations/:id/paiement')
  enregistrerPaiement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnregistrerPaiementDto,
  ) {
    return this.billing.enregistrerPaiement(user, id, dto);
  }
}
