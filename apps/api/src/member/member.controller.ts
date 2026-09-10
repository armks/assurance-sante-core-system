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
import { AdherentService } from './adherent.service';
import {
  ChangerStatutDto,
  CreateAdherentDto,
  CreateBeneficiaireDto,
  UpdateAdherentDto,
  UpdateBeneficiaireDto,
} from './dto/member.dto';

/**
 * Endpoints REST du module member — fichier des membres (v9 phase 3, PROMPT 12).
 * Lecture ouverte à l'organisation (et à l'adhérent lui-même via RLS) ; écriture
 * réservée au personnel ASSUREUR habilité + SOCIETE_ADMINISTRATION (vérifié dans
 * AdherentService, en plus des policies RLS Postgres).
 */
@Controller('member')
@UseGuards(SupabaseAuthGuard)
export class MemberController {
  constructor(private readonly adherents: AdherentService) {}

  // --- Adhérents ---------------------------------------------------

  @Post('adherents')
  creerAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAdherentDto,
  ) {
    return this.adherents.creerAdherent(user, dto);
  }

  @Get('adherents')
  listerAdherents(
    @CurrentUser() user: AuthenticatedUser,
    @Query('statut') statut?: string,
    @Query('souscripteurId') souscripteurId?: string,
    @Query('q') q?: string,
  ) {
    return this.adherents.listerAdherents(user, { statut, souscripteurId, q });
  }

  @Get('adherents/:id')
  obtenirAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adherents.obtenirAdherent(user, id);
  }

  @Patch('adherents/:id')
  modifierAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdherentDto,
  ) {
    return this.adherents.modifierAdherent(user, id, dto);
  }

  @Patch('adherents/:id/statut')
  changerStatutAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangerStatutDto,
  ) {
    return this.adherents.changerStatutAdherent(user, id, dto);
  }

  @Delete('adherents/:id')
  @HttpCode(204)
  supprimerAdherent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adherents.supprimerAdherent(user, id);
  }

  // --- Bénéficiaires ----------------------------------------------

  @Post('adherents/:id/beneficiaires')
  ajouterBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBeneficiaireDto,
  ) {
    return this.adherents.ajouterBeneficiaire(user, id, dto);
  }

  @Get('adherents/:id/beneficiaires')
  listerBeneficiaires(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adherents.listerBeneficiaires(user, id);
  }

  @Patch('adherents/:id/beneficiaires/:beneficiaireId')
  modifierBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('beneficiaireId', ParseUUIDPipe) beneficiaireId: string,
    @Body() dto: UpdateBeneficiaireDto,
  ) {
    return this.adherents.modifierBeneficiaire(user, id, beneficiaireId, dto);
  }

  @Patch('adherents/:id/beneficiaires/:beneficiaireId/statut')
  changerStatutBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('beneficiaireId', ParseUUIDPipe) beneficiaireId: string,
    @Body() dto: ChangerStatutDto,
  ) {
    return this.adherents.changerStatutBeneficiaire(
      user,
      id,
      beneficiaireId,
      dto,
    );
  }

  @Delete('adherents/:id/beneficiaires/:beneficiaireId')
  @HttpCode(204)
  supprimerBeneficiaire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('beneficiaireId', ParseUUIDPipe) beneficiaireId: string,
  ) {
    return this.adherents.supprimerBeneficiaire(user, id, beneficiaireId);
  }
}
