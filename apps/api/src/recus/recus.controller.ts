import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ParametresImpressionDto, RecuQueryDto } from './recus.dto';
import { RecusService } from './recus.service';

/** Paramétrage de l'imprimante (thermique ou A4) et reçus de caisse de l'établissement sanitaire / de la pharmacie. */
@Controller('recus')
@UseGuards(SupabaseAuthGuard)
export class RecusController {
  constructor(private readonly recus: RecusService) {}

  @Get('parametres')
  parametres(@CurrentUser() user: AuthenticatedUser) {
    return this.recus.lireParametres(user);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Put('parametres')
  enregistrer(@CurrentUser() user: AuthenticatedUser, @Body() dto: ParametresImpressionDto) {
    return this.recus.enregistrerParametres(user, dto);
  }

  /** Reçu de caisse d'une facture de soins réglée par le patient (établissement). */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('facture-soins/:id')
  async factureSoins(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: RecuQueryDto) {
    const r = await this.recus.recuFactureSoins(user, id, q.imprimante);
    return new StreamableFile(r.buffer, { type: r.type, disposition: `inline; filename="${r.nomFichier}"` });
  }

  /** Reçu de caisse d'une dispensation de médicaments réglée (pharmacie). */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('dispensation/:id')
  async dispensation(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: RecuQueryDto) {
    const r = await this.recus.recuDispensation(user, id, q.imprimante);
    return new StreamableFile(r.buffer, { type: r.type, disposition: `inline; filename="${r.nomFichier}"` });
  }
}
