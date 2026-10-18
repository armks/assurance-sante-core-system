import { Controller, Get, Query, StreamableFile, UseGuards, Header } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ExportFacturationQueryDto, RapportFacturationQueryDto } from './facturation.dto';
import { FacturationReportingService } from './facturation.service';
import { ExportRapportQueryDto, RapportActiviteQueryDto } from './reporting.dto';
import { ReportingService } from './reporting.service';

/**
 * Rapports et statistiques à critères multiples. Lecture seule ; le périmètre (organisation, établissement pour le personnel
 * de centre médical) est imposé côté serveur, jamais par les critères transmis.
 */
@Controller('reporting')
@UseGuards(SupabaseAuthGuard)
export class ReportingController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly facturation: FacturationReportingService,
  ) {}

  /** Listes de choix des filtres. */
  @Get('options')
  options(@CurrentUser() user: AuthenticatedUser) {
    return this.reporting.options(user);
  }

  @Get('activite')
  activite(@CurrentUser() user: AuthenticatedUser, @Query() filtres: RapportActiviteQueryDto) {
    return this.reporting.activite(user, filtres);
  }

  /** Export imprimable (PDF ou Word) du rapport d'activité — mêmes critères et mêmes chiffres que l'écran. */
  @Get('activite/export')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async exporter(@CurrentUser() user: AuthenticatedUser, @Query() dto: ExportRapportQueryDto) {
    const { format, ...filtres } = dto;
    const f = await this.reporting.exporter(user, filtres, format);
    return new StreamableFile(f.buffer, {
      type: f.type,
      disposition: `attachment; filename="${f.nomFichier}"`,
    });
  }

  /** Listes de choix du rapport de facturation (établissements, pharmacies, statuts). */
  @Get('facturation-mensuelle/options')
  optionsFacturation(@CurrentUser() user: AuthenticatedUser) {
    return this.facturation.options(user);
  }

  @Get('facturation-mensuelle')
  facturationMensuelle(@CurrentUser() user: AuthenticatedUser, @Query() filtres: RapportFacturationQueryDto) {
    return this.facturation.rapport(user, filtres);
  }

  @Get('facturation-mensuelle/export')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async exporterFacturation(@CurrentUser() user: AuthenticatedUser, @Query() dto: ExportFacturationQueryDto) {
    const { format, ...filtres } = dto;
    const f = await this.facturation.exporter(user, filtres, format);
    return new StreamableFile(f.buffer, { type: f.type, disposition: `attachment; filename="${f.nomFichier}"` });
  }
}
