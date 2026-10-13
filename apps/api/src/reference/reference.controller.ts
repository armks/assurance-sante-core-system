import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  ActivationMasseDto,
  HomologuerMedicamentDto,
  MotifDto,
  ProposerActeDto,
  ProposerMedicamentDto,
} from './dto/reference.dto';
import { CatalogueActivationService } from './catalogue-activation.service';
import { CategoriesActeService } from './categories-acte.service';
import { ReferenceService } from './reference.service';

/**
 * Endpoints REST du module reference — référentiels médicaux (actes + médicaments).
 * Lecture ouverte à toute personne de l'organisation ; proposition réservée à
 * ASSUREUR_INFORMATIQUE ; homologation réservée EXCLUSIVEMENT à
 * ASSUREUR_MEDECIN_CONSEIL (actes) / ASSUREUR_PHARMACIEN_CONSEIL (médicaments).
 */
@Controller('reference')
@UseGuards(SupabaseAuthGuard)
export class ReferenceController {
  constructor(
    private readonly reference: ReferenceService,
    private readonly categoriesActe: CategoriesActeService,
    private readonly activation: CatalogueActivationService,
  ) {}

  /**
   * Référentiel unique des catégories d'acte (libellé, type de réclamation,
   * rôle de revue, actif) — tout compte authentifié, sans condition
   * d'organisation : donnée de référence non sensible (prisma/sql/067).
   */
  @Get('categories-acte')
  listerCategoriesActe() {
    return this.categoriesActe.lister();
  }

  // --- Catalogue national partagé (v1 §10.4, PROMPT 23) --------

  /** Catalogue national (hors retirés) + état d'ACTIVATION pour l'organisation de l'appelant (ADR-009). */
  @Get('catalogue-national/actes')
  listerCatalogueNationalActes(@CurrentUser() user: AuthenticatedUser, @Query('statut') statut?: string) {
    return this.activation.lister(user, 'actes', { statut });
  }

  @Get('catalogue-national/medicaments')
  listerCatalogueNationalMedicaments(@CurrentUser() user: AuthenticatedUser, @Query('statut') statut?: string) {
    return this.activation.lister(user, 'medicaments', { statut });
  }

  /** Activation / désactivation en masse (liste d'identifiants OU tout le catalogue) — déclarées avant les routes `:itemId/...`. */
  @Post('catalogue-national/actes/activation-masse')
  activationMasseActes(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActivationMasseDto) {
    return this.activation.activationMasse(user, 'actes', dto);
  }

  @Post('catalogue-national/medicaments/activation-masse')
  activationMasseMedicaments(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActivationMasseDto) {
    return this.activation.activationMasse(user, 'medicaments', dto);
  }

  @Post('catalogue-national/actes/:itemId/activer')
  activerActe(@CurrentUser() user: AuthenticatedUser, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.activation.activer(user, 'actes', itemId);
  }

  @Post('catalogue-national/actes/:itemId/desactiver')
  desactiverActe(@CurrentUser() user: AuthenticatedUser, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: MotifDto) {
    return this.activation.desactiver(user, 'actes', itemId, dto.motif);
  }

  @Post('catalogue-national/medicaments/:itemId/activer')
  activerMedicament(@CurrentUser() user: AuthenticatedUser, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.activation.activer(user, 'medicaments', itemId);
  }

  @Post('catalogue-national/medicaments/:itemId/desactiver')
  desactiverMedicament(@CurrentUser() user: AuthenticatedUser, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: MotifDto) {
    return this.activation.desactiver(user, 'medicaments', itemId, dto.motif);
  }

  // --- Actes ---------------------------------------------------

  @Post('actes')
  proposerActe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ProposerActeDto,
  ) {
    return this.reference.proposerActe(user, dto);
  }

  @Get('actes')
  listerActes(
    @CurrentUser() user: AuthenticatedUser,
    @Query('statut') statut?: string,
  ) {
    return this.reference.listerActes(user, { statut });
  }

  @Get('actes/:id')
  obtenirActe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reference.obtenirActe(user, id);
  }

  @Post('actes/:id/homologuer')
  homologuerActe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reference.homologuerActe(user, id);
  }

  @Post('actes/:id/suspendre')
  suspendreActe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MotifDto,
  ) {
    return this.reference.suspendreActe(user, id, dto.motif);
  }

  @Post('actes/:id/retirer')
  retirerActe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MotifDto,
  ) {
    return this.reference.retirerActe(user, id, dto.motif);
  }

  @Post('actes/:id/reproposer')
  reproposerActe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reference.reproposerActe(user, id);
  }

  /** Acte jamais homologué et sans lien — service informatique (ADR-007). */
  @Delete('actes/:id')
  @HttpCode(204)
  supprimerActe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reference.supprimerActe(user, id);
  }

  // --- Médicaments ------------------------------------------

  @Post('medicaments')
  proposerMedicament(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ProposerMedicamentDto,
  ) {
    return this.reference.proposerMedicament(user, dto);
  }

  @Get('medicaments')
  listerMedicaments(
    @CurrentUser() user: AuthenticatedUser,
    @Query('statut') statut?: string,
    @Query('essentiel') essentiel?: string,
  ) {
    return this.reference.listerMedicaments(user, {
      statut,
      essentiel:
        essentiel === undefined ? undefined : essentiel === 'true',
    });
  }

  @Get('medicaments/:id')
  obtenirMedicament(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reference.obtenirMedicament(user, id);
  }

  @Post('medicaments/:id/homologuer')
  homologuerMedicament(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HomologuerMedicamentDto,
  ) {
    return this.reference.homologuerMedicament(user, id, dto);
  }

  @Post('medicaments/:id/suspendre')
  suspendreMedicament(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MotifDto,
  ) {
    return this.reference.suspendreMedicament(user, id, dto.motif);
  }

  @Post('medicaments/:id/retirer')
  retirerMedicament(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MotifDto,
  ) {
    return this.reference.retirerMedicament(user, id, dto.motif);
  }

  /** Médicament jamais homologué et sans lien — service informatique (ADR-007). */
  @Delete('medicaments/:id')
  @HttpCode(204)
  supprimerMedicament(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reference.supprimerMedicament(user, id);
  }

  @Post('medicaments/:id/reproposer')
  reproposerMedicament(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reference.reproposerMedicament(user, id);
  }
}
