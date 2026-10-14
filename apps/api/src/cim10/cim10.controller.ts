import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { Cim10Service, type FichierCim10 } from './cim10.service';
import { CreerMaladieCim10Dto, ModifierMaladieCim10Dto } from './dto/cim10.dto';

/**
 * Référentiel CIM-10. Recherche ouverte à tout compte authentifié (sélecteur du médecin) ;
 * gestion et import réservés à SUPERADMIN_PRINCIPAL (vérifié dans le service + RLS).
 */
@Controller('cim10')
@UseGuards(SupabaseAuthGuard)
export class Cim10Controller {
  constructor(private readonly cim10: Cim10Service) {}

  @Get()
  rechercher(@Query('q') q?: string, @Query('limite') limite?: string) {
    return this.cim10.rechercher(q, limite ? Number(limite) : undefined);
  }

  // Routes d'administration déclarées AVANT `:id`.
  @Get('admin')
  listerAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('statut') statut?: string,
  ) {
    return this.cim10.listerAdmin(user, q, page ? Number(page) : undefined, statut);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('fichier', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importer(@CurrentUser() user: AuthenticatedUser, @UploadedFile() fichier: FichierCim10) {
    return this.cim10.importer(user, fichier);
  }

  @Post()
  creer(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreerMaladieCim10Dto) {
    return this.cim10.creer(user, dto);
  }

  @Patch(':id')
  modifier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModifierMaladieCim10Dto,
  ) {
    return this.cim10.modifier(user, id, dto);
  }

  @Post(':id/desactiver')
  desactiver(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cim10.changerStatut(user, id, false);
  }

  @Post(':id/reactiver')
  reactiver(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cim10.changerStatut(user, id, true);
  }

  @Delete(':id')
  supprimer(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cim10.supprimer(user, id);
  }
}
