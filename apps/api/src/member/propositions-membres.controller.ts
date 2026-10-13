import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  ListerPropositionsMembresQueryDto,
  ProposerAdherentMembreDto,
  ProposerBeneficiaireMembreDto,
  RejeterPropositionMembreDto,
} from './dto/propositions-membres.dto';
import { PropositionsMembresService } from './propositions-membres.service';

/** La société PROPOSE (adhérent, bénéficiaire) ; l'assureur valide ou rejette (motif). Aucune création directe côté société. */
@Controller('member/propositions-membres')
@UseGuards(SupabaseAuthGuard)
export class PropositionsMembresController {
  constructor(private readonly propositions: PropositionsMembresService) {}

  @Post('adherent')
  proposerAdherent(@CurrentUser() user: AuthenticatedUser, @Body() dto: ProposerAdherentMembreDto) {
    return this.propositions.proposerAdherent(user, dto);
  }

  @Post('beneficiaire')
  proposerBeneficiaire(@CurrentUser() user: AuthenticatedUser, @Body() dto: ProposerBeneficiaireMembreDto) {
    return this.propositions.proposerBeneficiaire(user, dto);
  }

  @Get()
  lister(@CurrentUser() user: AuthenticatedUser, @Query() q: ListerPropositionsMembresQueryDto) {
    return this.propositions.lister(user, q);
  }

  @Post(':id/valider')
  valider(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.propositions.valider(user, id);
  }

  @Post(':id/rejeter')
  rejeter(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejeterPropositionMembreDto) {
    return this.propositions.rejeter(user, id, dto.motif);
  }

  @Delete(':id')
  retirer(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.propositions.retirer(user, id);
  }
}
