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
import { ClaimsService } from './claims.service';
import { SoumettreReclamationDto } from './dto/claims.dto';

/**
 * Endpoints REST du module claims — réception des réclamations (PROMPT 24, partie 1).
 * `soumettre` verrouille la réclamation (SOUMISE → EN_ADJUDICATION) de façon
 * idempotente. L'adjudication (microservice Java) sera branchée au prompt suivant.
 */
@Controller('claims/reclamations')
@UseGuards(SupabaseAuthGuard)
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Post('soumettre')
  soumettre(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SoumettreReclamationDto,
  ) {
    return this.claims.soumettre(user, dto);
  }

  @Get()
  lister(
    @CurrentUser() user: AuthenticatedUser,
    @Query('statut') statut?: string,
  ) {
    return this.claims.listerReclamations(user, { statut });
  }

  @Get(':id')
  obtenir(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.claims.obtenirReclamation(user, id);
  }
}
