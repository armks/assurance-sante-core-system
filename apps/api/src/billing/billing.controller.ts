import { AjusterGrillesDto } from './dto/billing.dto';
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
import { BillingService } from './billing.service';
import {
  CalculerCotisationDto,
  ConsoliderFactureSocieteDto,
  CreateGrilleDto,
  AnnulerCotisationDto,
  EnregistrerPaiementDto,
  GenererCotisationsDto,
  UpdateGrilleDto,
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

  /** Hausse ou baisse (%) de toutes les grilles d'une formule, avec motif — s'applique aux cotisations à venir. */
  @Post('grilles-tarifaires/ajuster')
  ajusterGrilles(@CurrentUser() user: AuthenticatedUser, @Body() dto: AjusterGrillesDto) {
    return this.billing.ajusterGrilles(user, dto);
  }

  @Get('grilles-tarifaires')
  listerGrilles(
    @CurrentUser() user: AuthenticatedUser,
    @Query('produitId') produitId?: string,
    @Query('souscripteurId') souscripteurId?: string,
  ) {
    return this.billing.listerGrilles(user, { produitId, souscripteurId });
  }

  /** Modification permise même si la grille a servi (ADR-007). */
  @Patch('grilles-tarifaires/:id')
  modifierGrille(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGrilleDto,
  ) {
    return this.billing.modifierGrille(user, id, dto);
  }

  /** Suppression d'une grille jamais utilisée par un calcul (ADR-007). */
  @Delete('grilles-tarifaires/:id')
  @HttpCode(204)
  supprimerGrille(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.billing.supprimerGrille(user, id);
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

  /** Annulation (A_PAYER sans paiement) — motif obligatoire ; une cotisation n'est jamais supprimée. */
  @Post('cotisations/:id/annuler')
  annulerCotisation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnnulerCotisationDto,
  ) {
    return this.billing.annulerCotisation(user, id, dto.motif);
  }

  @Post('cotisations/:id/paiement')
  enregistrerPaiement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnregistrerPaiementDto,
  ) {
    return this.billing.enregistrerPaiement(user, id, dto);
  }

  // --- Facturation par société (coupure de facturation mensuelle) ---
  @Get('souscripteurs/:souscripteurId/adherents-facturation')
  listerAdherentsPourFacturation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('souscripteurId', ParseUUIDPipe) souscripteurId: string,
    @Query('periode') periode: string,
  ) {
    return this.billing.listerAdherentsPourFacturation(user, souscripteurId, periode);
  }

  @Post('souscripteurs/:souscripteurId/consolider-facture')
  consoliderFacturationSociete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('souscripteurId', ParseUUIDPipe) souscripteurId: string,
    @Body() dto: ConsoliderFactureSocieteDto,
  ) {
    return this.billing.consoliderFacturationSociete(user, souscripteurId, dto.periode, dto.dateEcheance);
  }
}
