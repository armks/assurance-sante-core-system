import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AjusterTarifDto, FileTarifsProposesQueryDto, ProposerTarifDto, RefuserTarifDto, ValiderTarifDto } from './dto/tarifs-proposes.dto';
import { TarifsProposesService } from './tarifs-proposes.service';

/** Tarifs proposés par les établissements pour les actes non tarifables (ADR-008, lot 4). */
@Controller('tarifs-proposes')
@UseGuards(SupabaseAuthGuard)
export class TarifsProposesController {
  constructor(private readonly tarifs: TarifsProposesService) {}

  /** File « Tarifs proposés à examiner » (médecin conseil ; direction en lecture) — pagination serveur. */
  @Get('file')
  file(@CurrentUser() user: AuthenticatedUser, @Query() q: FileTarifsProposesQueryDto) {
    return this.tarifs.file(user, q);
  }

  /** Compteur du tableau de bord. */
  @Get('compteur')
  compteur(@CurrentUser() user: AuthenticatedUser) {
    return this.tarifs.compteur(user);
  }

  /** Rappel J+2 et escalade J+5 (déclenchable à la main — aucun planificateur automatique). */
  @Post('rappels')
  rappels(@CurrentUser() user: AuthenticatedUser) {
    return this.tarifs.envoyerRappels(user);
  }

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

  @Post(':id/valider')
  valider(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ValiderTarifDto) {
    return this.tarifs.decider(user, id, 'VALIDER', { ajouterConvention: dto.ajouterConvention });
  }

  @Post(':id/ajuster')
  ajuster(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AjusterTarifDto) {
    return this.tarifs.decider(user, id, 'AJUSTER', { montantDecide: dto.montantDecide, motif: dto.motif, ajouterConvention: dto.ajouterConvention });
  }

  @Post(':id/refuser')
  refuser(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefuserTarifDto) {
    return this.tarifs.decider(user, id, 'REFUSER', { motif: dto.motif });
  }

  @Post()
  proposer(@CurrentUser() user: AuthenticatedUser, @Body() dto: ProposerTarifDto) {
    return this.tarifs.proposer(user, dto);
  }
}
