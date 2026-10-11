import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AccueilCarteService } from './accueil-carte.service';

/** Aucun champ de contact : l'accueil ne saisit jamais d'adresse ni de numéro — il choisit un CANAL parmi les contacts de la fiche. */
export class EmettreCodeAccueilDto {
  @IsString({ message: 'numeroCarte est requis.' })
  @MinLength(1)
  @MaxLength(40)
  numeroCarte!: string;

  @IsString({ message: 'categorieActe est requis.' })
  @MinLength(1)
  @MaxLength(60)
  categorieActe!: string;

  @IsIn(['EMAIL', 'SMS'], { message: 'canal doit être EMAIL ou SMS.' })
  canal!: 'EMAIL' | 'SMS';
}

@Controller('accueil')
@UseGuards(SupabaseAuthGuard)
export class AccueilController {
  constructor(private readonly accueil: AccueilCarteService) {}

  @Get('carte')
  fiche(@CurrentUser() user: AuthenticatedUser, @Query('numeroCarte') numeroCarte: string) {
    return this.accueil.fiche(user, numeroCarte);
  }

  @Get('types-acte')
  typesActe(@CurrentUser() user: AuthenticatedUser) {
    return this.accueil.typesActe(user);
  }

  @Post('codes-consultation')
  emettre(@CurrentUser() user: AuthenticatedUser, @Body() dto: EmettreCodeAccueilDto) {
    return this.accueil.emettreCode(user, dto);
  }
}
