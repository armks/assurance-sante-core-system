import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  ApprovisionnerCompteDto,
  AssocierFacturesPourPaiementDto,
  CreerCompteFinancierDto,
} from './dto/payment.dto';
import { PaymentService, type FichierTeleverse } from './payment.service';

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

  // --- Mouvements entre comptes + dépenses courantes — même périmètre
  // EXCLUSIF que les comptes financiers. Multipart (pièce jointe optionnelle)
  // : champs extraits individuellement via @Body('champ'), même convention
  // que ContestationController (pas de DTO class-validator sur ces routes).

  @Get('mouvements')
  listerMouvementsFinanciers(@CurrentUser() user: AuthenticatedUser) {
    return this.payment.listerMouvementsFinanciers(user);
  }

  @Get('mouvements/:id/piece')
  obtenirUrlPieceJointeMouvement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payment.obtenirUrlPieceJointeMouvement(user, id);
  }

  @Post('mouvements/transfert')
  @UseInterceptors(FileInterceptor('pieceJointe'))
  transfererEntreComptes(
    @CurrentUser() user: AuthenticatedUser,
    @Body('compteSourceId') compteSourceId: string,
    @Body('compteDestinationId') compteDestinationId: string,
    @Body('montant') montant: string,
    @Body('description') description: string | undefined,
    @UploadedFile() pieceJointe: FichierTeleverse | undefined,
  ) {
    return this.payment.transfererEntreComptes(
      user,
      compteSourceId,
      compteDestinationId,
      montant,
      description,
      pieceJointe ?? null,
    );
  }

  @Post('mouvements/depense')
  @UseInterceptors(FileInterceptor('pieceJointe'))
  enregistrerDepense(
    @CurrentUser() user: AuthenticatedUser,
    @Body('compteId') compteId: string,
    @Body('montant') montant: string,
    @Body('description') description: string,
    @UploadedFile() pieceJointe: FichierTeleverse | undefined,
  ) {
    return this.payment.enregistrerDepense(user, compteId, montant, description, pieceJointe ?? null);
  }
}
