import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { DemandesAdhesionService } from './demandes-adhesion.service';

/**
 * Demandes du formulaire « Adhésion » (authentifié) :
 *   GET  /api/v1/vitrine/demandes-adhesion              liste de l'organisation
 *   POST /api/v1/vitrine/demandes-adhesion/:id/traiter  NOUVEAU → TRAITE
 * Réservé à ASSUREUR_INFORMATIQUE / ASSUREUR_EXPLOITATION (DemandesAdhesionService).
 */
@Controller('vitrine/demandes-adhesion')
@UseGuards(SupabaseAuthGuard)
export class DemandesAdhesionController {
  constructor(private readonly demandes: DemandesAdhesionService) {}

  @Get()
  lister(@CurrentUser() user: AuthenticatedUser) {
    return this.demandes.lister(user);
  }

  @Post(':id/traiter')
  marquerTraitee(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.demandes.marquerTraitee(user, id);
  }
}
