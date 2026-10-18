import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
  ActionMasseCatalogueDto,
  CreerActeNationalDto,
  CreerLettreCleDto,
  CreerMedicamentNationalDto,
  DefinirParametreDto,
  ModifierActeNationalDto,
  ModifierLettreCleDto,
  RechercheCatalogueQueryDto,
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
    @Query() filtres: RechercheCatalogueQueryDto,
  ) {
    return this.config.listerActesNational(user, { statut: filtres.statut, q: filtres.q, page: filtres.page, limite: filtres.limite });
  }

  @Post('catalogue-national/actes')
  creerActeNational(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreerActeNationalDto,
  ) {
    return this.config.creerActeNational(user, dto);
  }

  /** Modification (libellé, chapitre, cotation) d'un acte du catalogue national. */
  @Patch('catalogue-national/actes/:id')
  modifierActeNational(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModifierActeNationalDto,
  ) {
    return this.config.modifierActeNational(user, id, dto);
  }

  // --- Lettres-clés de la nomenclature (aucune valeur chiffrée) ---

  @Get('lettres-cles')
  listerLettresCles(@CurrentUser() user: AuthenticatedUser) {
    return this.config.listerLettresCles(user);
  }

  @Post('lettres-cles')
  creerLettreCle(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreerLettreCleDto) {
    return this.config.creerLettreCle(user, dto);
  }

  @Patch('lettres-cles/:id')
  modifierLettreCle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModifierLettreCleDto,
  ) {
    return this.config.modifierLettreCle(user, id, dto);
  }

  @Post('lettres-cles/:id/desactiver')
  desactiverLettreCle(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.config.changerStatutLettreCle(user, id, 'archiver');
  }

  @Post('lettres-cles/:id/reactiver')
  reactiverLettreCle(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.config.changerStatutLettreCle(user, id, 'desarchiver');
  }

  @Delete('lettres-cles/:id')
  supprimerLettreCle(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.config.supprimerLettreCle(user, id);
  }

  @Delete('catalogue-national/actes/:id')
  supprimerActeNational(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.config.supprimerActeNational(user, id);
  }

/** Archivage : retiré du catalogue (plus importable), copies existantes inchangées. */
  @Post('catalogue-national/actes/:id/retirer')
  retirerActeNational(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.config.changerStatutNational(user, 'actes', id, 'archiver');
  }

  /** Désarchivage : de nouveau homologué et importable. */
  @Post('catalogue-national/actes/:id/reactiver')
  reactiverActeNational(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.config.changerStatutNational(user, 'actes', id, 'desarchiver');
  }

  // --- Actions de masse (SUPERADMIN) : un endpoint par action, un contrôle par élément ---
  @Post('catalogue-national/actes/masse/archiver')
  archiverActesEnMasse(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActionMasseCatalogueDto) {
    return this.config.actionMasseCatalogue(user, 'actes', 'archiver', dto.ids);
  }

  @Post('catalogue-national/actes/masse/desarchiver')
  desarchiverActesEnMasse(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActionMasseCatalogueDto) {
    return this.config.actionMasseCatalogue(user, 'actes', 'desarchiver', dto.ids);
  }

  @Post('catalogue-national/actes/masse/supprimer')
  supprimerActesEnMasse(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActionMasseCatalogueDto) {
    return this.config.actionMasseCatalogue(user, 'actes', 'supprimer', dto.ids);
  }

  @Post('catalogue-national/medicaments/masse/archiver')
  archiverMedicamentsEnMasse(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActionMasseCatalogueDto) {
    return this.config.actionMasseCatalogue(user, 'medicaments', 'archiver', dto.ids);
  }

  @Post('catalogue-national/medicaments/masse/desarchiver')
  desarchiverMedicamentsEnMasse(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActionMasseCatalogueDto) {
    return this.config.actionMasseCatalogue(user, 'medicaments', 'desarchiver', dto.ids);
  }

  @Post('catalogue-national/medicaments/masse/supprimer')
  supprimerMedicamentsEnMasse(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActionMasseCatalogueDto) {
    return this.config.actionMasseCatalogue(user, 'medicaments', 'supprimer', dto.ids);
  }

  @Post('catalogue-national/actes/masse/homologuer')
  homologuerActesEnMasse(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActionMasseCatalogueDto) {
    return this.config.actionMasseCatalogue(user, 'actes', 'homologuer', dto.ids);
  }

  @Post('catalogue-national/medicaments/masse/homologuer')
  homologuerMedicamentsEnMasse(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActionMasseCatalogueDto) {
    return this.config.actionMasseCatalogue(user, 'medicaments', 'homologuer', dto.ids);
  }

  @Post('catalogue-national/actes/:id/homologuer')
  homologuerActe(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.config.homologuerNational(user, 'actes', id);
  }

  @Post('catalogue-national/medicaments/:id/homologuer')
  homologuerMedicament(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.config.homologuerNational(user, 'medicaments', id);
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

/** Archivage : retiré du catalogue (plus importable), copies existantes inchangées. */
  @Post('catalogue-national/medicaments/:id/retirer')
  retirerMedicamentNational(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.config.changerStatutNational(user, 'medicaments', id, 'archiver');
  }

  /** Désarchivage : de nouveau homologué et importable. */
  @Post('catalogue-national/medicaments/:id/reactiver')
  reactiverMedicamentNational(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.config.changerStatutNational(user, 'medicaments', id, 'desarchiver');
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
