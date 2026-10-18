import { Controller, Get, Query, StreamableFile, UseGuards, Header } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ExportCotisationsQueryDto, ExportFinancesQueryDto, RapportCotisationsQueryDto, RapportFinancesQueryDto } from './finance.dto';
import { FinanceReportingService } from './finance.service';
import { ExportDispensationsQueryDto, PharmacieReportingService, RapportDispensationsQueryDto } from './pharmacie.service';
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
    private readonly finance: FinanceReportingService,
    private readonly pharmacie: PharmacieReportingService,
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

  @Get('cotisations/options')
  optionsCotisations(@CurrentUser() user: AuthenticatedUser) {
    return this.finance.optionsCotisations(user);
  }

  @Get('cotisations')
  cotisations(@CurrentUser() user: AuthenticatedUser, @Query() filtres: RapportCotisationsQueryDto) {
    return this.finance.cotisations(user, filtres);
  }

  @Get('cotisations/export')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async exporterCotisations(@CurrentUser() user: AuthenticatedUser, @Query() dto: ExportCotisationsQueryDto) {
    const { format, ...filtres } = dto;
    const f = await this.finance.exporterCotisations(user, filtres, format);
    return new StreamableFile(f.buffer, { type: f.type, disposition: `attachment; filename="${f.nomFichier}"` });
  }

  @Get('finances/options')
  optionsFinances(@CurrentUser() user: AuthenticatedUser) {
    return this.finance.optionsFinances(user);
  }

  @Get('finances')
  finances(@CurrentUser() user: AuthenticatedUser, @Query() filtres: RapportFinancesQueryDto) {
    return this.finance.finances(user, filtres);
  }

  @Get('finances/export')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async exporterFinances(@CurrentUser() user: AuthenticatedUser, @Query() dto: ExportFinancesQueryDto) {
    const { format, ...filtres } = dto;
    const f = await this.finance.exporterFinances(user, filtres, format);
    return new StreamableFile(f.buffer, { type: f.type, disposition: `attachment; filename="${f.nomFichier}"` });
  }

  @Get('dispensations/options')
  optionsDispensations(@CurrentUser() user: AuthenticatedUser) {
    return this.pharmacie.options(user);
  }

  @Get('dispensations')
  dispensations(@CurrentUser() user: AuthenticatedUser, @Query() filtres: RapportDispensationsQueryDto) {
    return this.pharmacie.rapport(user, filtres);
  }

  @Get('dispensations/export')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async exporterDispensations(@CurrentUser() user: AuthenticatedUser, @Query() dto: ExportDispensationsQueryDto) {
    const { format, ...filtres } = dto;
    const f = await this.pharmacie.exporter(user, filtres, format);
    return new StreamableFile(f.buffer, { type: f.type, disposition: `attachment; filename="${f.nomFichier}"` });
  }
}
