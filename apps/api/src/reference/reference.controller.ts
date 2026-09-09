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
  HomologuerMedicamentDto,
  MotifDto,
  ProposerActeDto,
  ProposerMedicamentDto,
} from './dto/reference.dto';
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
  constructor(private readonly reference: ReferenceService) {}

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

  @Post('medicaments/:id/reproposer')
  reproposerMedicament(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reference.reproposerMedicament(user, id);
  }
}
