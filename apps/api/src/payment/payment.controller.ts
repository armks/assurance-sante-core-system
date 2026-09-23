import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  ApprovisionnerCompteDto,
  AssocierFacturesPourPaiementDto,
  CreerCompteFinancierDto,
} from './dto/payment.dto';
import { PaymentService } from './payment.service';

/**
 * Endpoints REST du module `payment/` — regroupement de factures mensuelles
 * (établissement/pharmacie) en paiements programmés, et vue d'ensemble globale
 * ASSUREUR_COMPTABLE.
 */
@Controller('payment')
@UseGuards(SupabaseAuthGuard)
export class PaymentController {
  constructor(private readonly payment: PaymentService) {}

  /** Côté ASSUREUR_COMPTABLE exclusivement : vue globale (établissement + pharmacie, tout statut). */
  @Get('factures-mensuelles')
  facturesPourComptableGlobal(@CurrentUser() user: AuthenticatedUser) {
    return this.payment.listerFacturesPourComptableGlobal(user);
  }

  /** Côté ASSUREUR_COMPTABLE exclusivement : liste des paiements groupés. */
  @Get('paiements-groupes')
  listerPaiementsGroupes(@CurrentUser() user: AuthenticatedUser) {
    return this.payment.listerPaiementsGroupes(user);
  }

  /** Côté ASSUREUR_COMPTABLE exclusivement : regroupe plusieurs factures VALIDÉES POUR PAIEMENT. */
  @Post('paiements-groupes')
  associerFacturesPourPaiement(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AssocierFacturesPourPaiementDto,
  ) {
    return this.payment.associerFacturesPourPaiement(user, dto);
  }

  /** Côté ASSUREUR_COMPTABLE exclusivement : marque le groupe payé (cascade sur ses factures). */
  @Post('paiements-groupes/:id/marquer-paye')
  marquerPaiementGroupePaye(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payment.marquerPaiementGroupePaye(user, id);
  }

  // --- Comptes financiers de l'assureur — réservé EXCLUSIVEMENT au rôle
  // EXACT ASSUREUR_COMPTABLE, jamais ASSUREUR_COMPTABLE_ADJOINT. ------------

  @Get('comptes-financiers')
  listerComptesFinanciers(@CurrentUser() user: AuthenticatedUser) {
    return this.payment.listerComptesFinanciers(user);
  }

  @Post('comptes-financiers')
  creerCompteFinancier(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreerCompteFinancierDto,
  ) {
    return this.payment.creerCompteFinancier(user, dto);
  }

  @Post('comptes-financiers/:id/approvisionner')
  approvisionnerCompte(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovisionnerCompteDto,
  ) {
    return this.payment.approvisionnerCompte(user, id, dto);
  }
}
