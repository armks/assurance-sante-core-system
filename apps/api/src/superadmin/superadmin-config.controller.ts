import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CatalogueImportService, type FichierTeleverse } from './catalogue-import.service';
import {
  CreerActeNationalDto,
  CreerMedicamentNationalDto,
  DefinirParametreDto,
} from './dto/superadmin-config.dto';
import { SuperadminConfigService } from './superadmin-config.service';

/**
 * Endpoints du panneau de configuration Super Admin (v1 §10.4, PROMPT 23) —
 * paramètres plateforme, santé système, catalogue national. Tout est réservé à
 * SUPERADMIN_PRINCIPAL (vérifié dans le service + RLS).
 */
@Controller('superadmin')
@UseGuards(SupabaseAuthGuard)
export class SuperadminConfigController {
  constructor(
    private readonly config: SuperadminConfigService,
    private readonly catalogueImport: CatalogueImportService,
  ) {}

  // --- Paramètres plateforme ---
  @Get('config/parametres')
  listerParametres(@CurrentUser() user: AuthenticatedUser) {
    return this.config.listerParametres(user);
  }

  @Get('config/parametres/:cle')
  obtenirParametre(
    @CurrentUser() user: AuthenticatedUser,
    @Param('cle') cle: string,
  ) {
    return this.config.obtenirParametre(user, cle);
  }

  @Put('config/parametres/:cle')
  definirParametre(
    @CurrentUser() user: AuthenticatedUser,
    @Param('cle') cle: string,
    @Body() dto: DefinirParametreDto,
  ) {
    return this.config.definirParametre(user, cle, dto);
  }

  // --- Santé du système ---
  @Get('sante-systeme')
  santeSysteme(@CurrentUser() user: AuthenticatedUser) {
    return this.config.santeSysteme(user);
  }

  // --- Catalogue national : actes ---
  @Get('catalogue-national/actes')
  listerActesNational(
    @CurrentUser() user: AuthenticatedUser,
    @Query('statut') statut?: string,
  ) {
    return this.config.listerActesNational(user, { statut });
  }

  @Post('catalogue-national/actes')
  creerActeNational(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreerActeNationalDto,
  ) {
    return this.config.creerActeNational(user, dto);
  }

  @Delete('catalogue-national/actes/:id')
  supprimerActeNational(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.config.supprimerActeNational(user, id);
  }

  // --- Catalogue national : médicaments ---
  @Get('catalogue-national/medicaments')
  listerMedicamentsNational(
    @CurrentUser() user: AuthenticatedUser,
    @Query('statut') statut?: string,
  ) {
    return this.config.listerMedicamentsNational(user, { statut });
  }

  @Post('catalogue-national/medicaments')
  creerMedicamentNational(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreerMedicamentNationalDto,
  ) {
    return this.config.creerMedicamentNational(user, dto);
  }

  @Delete('catalogue-national/medicaments/:id')
  supprimerMedicamentNational(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.config.supprimerMedicamentNational(user, id);
  }

  // --- Catalogue national : import en masse par Excel (réservé
  // EXCLUSIVEMENT SUPERADMIN_PRINCIPAL — import ET validation, pas de double
  // validation ici contrairement aux adhérents) ---

  @Post('catalogue-national/actes/import')
  @UseInterceptors(FileInterceptor('fichier'))
  importerActesExcel(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() fichier: FichierTeleverse,
  ) {
    return this.catalogueImport.importerCatalogueExcel(user, 'ACTES', fichier);
  }

  @Post('catalogue-national/medicaments/import')
  @UseInterceptors(FileInterceptor('fichier'))
  importerMedicamentsExcel(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() fichier: FichierTeleverse,
  ) {
    return this.catalogueImport.importerCatalogueExcel(user, 'MEDICAMENTS', fichier);
  }

  @Get('catalogue-national/imports')
  listerImportsCatalogue(@CurrentUser() user: AuthenticatedUser) {
    return this.catalogueImport.listerImportsCatalogue(user);
  }

  @Post('catalogue-national/imports/:id/valider')
  validerImportCatalogue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catalogueImport.validerImportCatalogue(user, id);
  }
}
