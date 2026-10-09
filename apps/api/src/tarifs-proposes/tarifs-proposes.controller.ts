import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ProposerTarifDto } from './dto/tarifs-proposes.dto';
import { TarifsProposesService } from './tarifs-proposes.service';

/** Tarifs proposés par les établissements pour les actes non tarifables (ADR-008, lot 4). */
@Controller('tarifs-proposes')
@UseGuards(SupabaseAuthGuard)
export class TarifsProposesController {
  constructor(private readonly tarifs: TarifsProposesService) {}

  @Get()
  lister(@CurrentUser() user: AuthenticatedUser, @Query('statut') statut?: string) {
    return this.tarifs.lister(user, statut);
  }

  @Get('actes-a-proposer')
  actesAProposer(@CurrentUser() user: AuthenticatedUser) {
    return this.tarifs.actesAProposer(user);
  }

  @Get(':id')
  obtenir(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tarifs.obtenir(user, id);
  }

  @Post()
  proposer(@CurrentUser() user: AuthenticatedUser, @Body() dto: ProposerTarifDto) {
    return this.tarifs.proposer(user, dto);
  }
}
