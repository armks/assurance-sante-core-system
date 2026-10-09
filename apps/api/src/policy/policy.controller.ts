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
  AnnulerMotifDto,
  ChangerStatutDto,
  CreateAvenantDto,
  CreateDevisDto,
  SimulerAvenantDto,
  SouscrireDto,
  UpdateAvenantDto,
  UpdatePoliceDto,
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

  @Get(':id/actions')
  actions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.policy.actionsDisponibles(user, id);
  }

  /** Modification libre d'une police au stade du DEVIS. */
  @Patch(':id')
  modifier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePoliceDto,
  ) {
    return this.policy.modifierPolice(user, id, dto);
  }

  /** Suppression (logique) d'un devis sans aucun lien. */
  @Delete(':id')
  @HttpCode(204)
  supprimer(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.policy.supprimerPolice(user, id);
  }

  /** « Dupliquer en devis » depuis une police terminée. */
  @Post(':id/dupliquer')
  dupliquer(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.policy.dupliquerEnDevis(user, id);
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

  @Post(':id/avenants/simulation')
  simulerAvenant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SimulerAvenantDto,
  ) {
    return this.policy.simulerAvenant(user, id, dto);
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

  /** Annulation d'un avenant APPLIQUE — motif obligatoire, jamais de suppression (ADR-007). */
  @Post(':id/avenants/:avenantId/annuler')
  annulerAvenant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('avenantId', ParseUUIDPipe) avenantId: string,
    @Body() dto: AnnulerMotifDto,
  ) {
    return this.policy.annulerAvenant(user, id, avenantId, dto.motif);
  }

  /** Modification d'un avenant en BROUILLON. */
  @Patch(':id/avenants/:avenantId')
  modifierAvenant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('avenantId', ParseUUIDPipe) avenantId: string,
    @Body() dto: UpdateAvenantDto,
  ) {
    return this.policy.modifierAvenant(user, id, avenantId, dto);
  }

  /** Suppression (logique) d'un avenant en BROUILLON. */
  @Delete(':id/avenants/:avenantId')
  @HttpCode(204)
  supprimerAvenant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('avenantId', ParseUUIDPipe) avenantId: string,
  ) {
    return this.policy.supprimerAvenant(user, id, avenantId);
  }
}
