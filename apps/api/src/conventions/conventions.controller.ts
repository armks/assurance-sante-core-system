import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { ConventionsService, type FichierTeleverse } from './conventions.service';
import {
  ArchiverConventionDto,
  CreerConventionDto,
  ListerConventionsQueryDto,
  ModifierConventionDto,
  NouvelleVersionDto,
  RefuserConventionDto,
  RemplacerActesDto,
  RemplacerValeursDto,
} from './dto/conventions.dto';

/** Conventions établissement × assureur (ADR-008, lot 2) — voir `ConventionsService` pour le circuit. */
@Controller('conventions')
@UseGuards(SupabaseAuthGuard)
export class ConventionsController {
  constructor(private readonly conventions: ConventionsService) {}

  @Get()
  lister(@CurrentUser() user: AuthenticatedUser, @Query() q: ListerConventionsQueryDto) {
    return this.conventions.lister(user, q);
  }

  /** Établissements sans convention validée en vigueur (tableau de bord de l'assurance informatique). */
  @Get('indicateurs')
  indicateurs(@CurrentUser() user: AuthenticatedUser) {
    return this.conventions.indicateurs(user);
  }

  /** Lettres-clés actives (lignes du formulaire de valeurs). */
  @Get('lettres-cles')
  lettresCles(@CurrentUser() user: AuthenticatedUser) {
    return this.conventions.lettresClesActives(user);
  }

  @Post()
  creer(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreerConventionDto) {
    return this.conventions.creer(user, dto);
  }

  @Get(':id')
  obtenir(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.conventions.obtenir(user, id);
  }

  @Patch(':id')
  modifier(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ModifierConventionDto) {
    return this.conventions.modifier(user, id, dto);
  }

  @Put(':id/valeurs')
  remplacerValeurs(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RemplacerValeursDto) {
    return this.conventions.remplacerValeurs(user, id, dto);
  }

  @Put(':id/actes')
  remplacerActes(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RemplacerActesDto) {
    return this.conventions.remplacerActes(user, id, dto);
  }

  @Post(':id/document')
  @UseInterceptors(FileInterceptor('document'))
  joindreDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() fichier: FichierTeleverse | undefined,
  ) {
    return this.conventions.joindreDocument(user, id, fichier);
  }

  @Get(':id/document')
  urlDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.conventions.urlDocument(user, id);
  }

  @Post(':id/valider')
  @HttpCode(200)
  valider(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.conventions.valider(user, id);
  }

  @Post(':id/refuser')
  @HttpCode(200)
  refuser(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefuserConventionDto) {
    return this.conventions.refuserConvention(user, id, dto.motif);
  }

  @Post(':id/reproposer')
  @HttpCode(200)
  reproposer(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.conventions.reproposer(user, id);
  }

  @Post(':id/nouvelle-version')
  nouvelleVersion(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NouvelleVersionDto) {
    return this.conventions.nouvelleVersion(user, id, dto);
  }

  @Post(':id/archiver')
  @HttpCode(200)
  archiver(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ArchiverConventionDto) {
    return this.conventions.archiver(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  supprimer(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.conventions.supprimer(user, id);
  }
}
