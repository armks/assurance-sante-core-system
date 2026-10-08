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
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ComptesService } from './comptes.service';
import { ChangerRoleDto, DesactivesPerimetreQuery, ReactiverPerimetreDto, RevoquerCompteDto } from './dto/comptes.dto';

/**
 * Cycle de vie des comptes utilisateurs (ADR-007, lot 4) — Assurance Informatique.
 * La LISTE des comptes reste `GET /identity/comptes` (IdentityController).
 */
@Controller('identity/comptes')
@UseGuards(SupabaseAuthGuard)
export class ComptesController {
  constructor(private readonly comptes: ComptesService) {}

  /** Comptes désactivés (par un archivage) d'un périmètre : liste de la confirmation « Tout réactiver ». */
  @Get('desactives')
  desactives(@CurrentUser() user: AuthenticatedUser, @Query() q: DesactivesPerimetreQuery) {
    return this.comptes.desactivesDuPerimetre(user, q.cible, q.id);
  }

  /** « Tout réactiver » : comptes désactivés d'un périmètre DÉSARCHIVÉ, en une transaction. */
  @Post('reactiver-perimetre')
  reactiverPerimetre(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReactiverPerimetreDto) {
    return this.comptes.reactiverPerimetre(user, dto.cible, dto.id);
  }

  @Post(':id/revoquer')
  revoquer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevoquerCompteDto,
  ) {
    return this.comptes.revoquer(user, id, dto.motif);
  }

  @Post(':id/reactiver')
  reactiver(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.comptes.reactiver(user, id);
  }

  @Patch(':id/role')
  changerRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangerRoleDto,
  ) {
    return this.comptes.changerRole(user, id, dto.role);
  }

  @Delete(':id')
  @HttpCode(204)
  supprimer(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.comptes.supprimer(user, id);
  }
}
