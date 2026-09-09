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
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CreateMembreComiteDto } from './dto/create-membre-comite.dto';
import { CreateSouscripteurDto } from './dto/create-souscripteur.dto';
import { UpdateSouscripteurDto } from './dto/update-souscripteur.dto';
import { TenantService } from './tenant.service';

/**
 * Endpoints REST du module tenant — gestion des souscripteurs, scopés par
 * `organisation_id`. Protégés par SupabaseAuthGuard ; la vérification fine du
 * rôle appelant est faite dans TenantService (défense en profondeur avec la RLS).
 */
@Controller('tenant/souscripteurs')
@UseGuards(SupabaseAuthGuard)
export class TenantController {
  constructor(private readonly tenant: TenantService) {}

  @Post()
  creer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSouscripteurDto,
  ) {
    return this.tenant.creer(user, dto);
  }

  @Get()
  lister(
    @CurrentUser() user: AuthenticatedUser,
    @Query('type') type?: string,
  ) {
    return this.tenant.lister(user, { type });
  }

  @Get(':id')
  obtenir(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenant.obtenir(user, id);
  }

  @Patch(':id')
  modifier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSouscripteurDto,
  ) {
    return this.tenant.modifier(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  supprimer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenant.supprimer(user, id);
  }

  @Get(':id/membres-comite')
  listerMembresComite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenant.listerMembresComite(user, id);
  }

  @Post(':id/membres-comite')
  ajouterMembreComite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMembreComiteDto,
  ) {
    return this.tenant.ajouterMembreComite(user, id, dto);
  }

  @Delete(':id/membres-comite/:membreId')
  @HttpCode(204)
  retirerMembreComite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membreId', ParseUUIDPipe) membreId: string,
  ) {
    return this.tenant.retirerMembreComite(user, id, membreId);
  }
}
