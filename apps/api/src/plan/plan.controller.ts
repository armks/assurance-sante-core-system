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
import {
  CreateGarantieDto,
  PublierProduitDto,
  UpdateGarantieDto,
} from './dto/garantie.dto';
import { CreateProduitDto, UpdateProduitDto } from './dto/produit.dto';
import { PlanService } from './plan.service';

/**
 * Endpoints REST du module plan — produits versionnés + garanties, scopés par
 * `organisation_id`. Lecture ouverte à toute personne de l'organisation ;
 * écriture réservée à ASSUREUR_DIRECTION / ASSUREUR_INFORMATIQUE (vérifié dans
 * PlanService, en plus de la RLS Postgres).
 */
@Controller('plan/produits')
@UseGuards(SupabaseAuthGuard)
export class PlanController {
  constructor(private readonly plan: PlanService) {}

  @Post()
  creer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProduitDto,
  ) {
    return this.plan.creerProduit(user, dto);
  }

  @Get()
  lister(
    @CurrentUser() user: AuthenticatedUser,
    @Query('statut') statut?: string,
    @Query('nom') nom?: string,
  ) {
    return this.plan.listerProduits(user, { statut, nom });
  }

  @Get(':id')
  obtenir(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.plan.obtenirProduit(user, id);
  }

  @Patch(':id')
  modifier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProduitDto,
  ) {
    return this.plan.modifierProduit(user, id, dto);
  }

  @Post(':id/publier')
  publier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublierProduitDto,
  ) {
    return this.plan.publier(user, id, dto);
  }

  @Post(':id/archiver')
  archiver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.plan.archiver(user, id);
  }

  /** ARCHIVE → PUBLIE, refusé si une autre version du même produit est publiée (ADR-007). */
  @Post(':id/desarchiver')
  desarchiver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.plan.desarchiver(user, id);
  }

  /** Brouillon sans police : supprimé AVEC ses garanties non utilisées (ADR-007). */
  @Delete(':id')
  @HttpCode(204)
  supprimer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.plan.supprimerProduit(user, id);
  }

  @Post(':id/nouvelle-version')
  nouvelleVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.plan.creerNouvelleVersion(user, id);
  }

  @Post(':id/garanties')
  ajouterGarantie(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGarantieDto,
  ) {
    return this.plan.ajouterGarantie(user, id, dto);
  }

  @Patch(':id/garanties/:garantieId')
  modifierGarantie(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('garantieId', ParseUUIDPipe) garantieId: string,
    @Body() dto: UpdateGarantieDto,
  ) {
    return this.plan.modifierGarantie(user, id, garantieId, dto);
  }

  @Delete(':id/garanties/:garantieId')
  @HttpCode(204)
  supprimerGarantie(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('garantieId', ParseUUIDPipe) garantieId: string,
  ) {
    return this.plan.supprimerGarantie(user, id, garantieId);
  }
}
