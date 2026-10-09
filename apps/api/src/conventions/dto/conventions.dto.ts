import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CONTEXTES_CONVENTION, POLITIQUES_DEPASSEMENT } from '../conventions.types';

export class CreerConventionDto {
  @IsUUID() etablissementId!: string;
  @IsString() @IsNotEmpty() @MaxLength(60) numero!: string;
  @IsISO8601() dateDebut!: string;
  @IsOptional() @IsISO8601() dateFin?: string;
  @IsOptional() @IsIn(POLITIQUES_DEPASSEMENT) politiqueDepassement?: (typeof POLITIQUES_DEPASSEMENT)[number];
}

export class ModifierConventionDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) numero?: string;
  @IsOptional() @IsISO8601() dateDebut?: string;
  /** `null` efface la date de fin (convention sans fin). */
  @IsOptional() dateFin?: string | null;
  @IsOptional() @IsIn(POLITIQUES_DEPASSEMENT) politiqueDepassement?: (typeof POLITIQUES_DEPASSEMENT)[number];
}

export class ValeurLettreCleDto {
  @IsString() @IsNotEmpty() @MaxLength(4) lettreCleCode!: string;
  @IsIn(CONTEXTES_CONVENTION) contexte!: (typeof CONTEXTES_CONVENTION)[number];
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) valeur!: number;
}

/** Remplace l'ensemble des valeurs de la convention (le formulaire est enregistré d'un bloc). */
export class RemplacerValeursDto {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ValeurLettreCleDto)
  valeurs!: ValeurLettreCleDto[];
}

export class ExceptionActeDto {
  @IsUUID() referentielActeId!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) prixForfaitaire?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) valeurLettreCle?: number;
}

/** Remplace l'ensemble des exceptions par acte de la convention. */
export class RemplacerActesDto {
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => ExceptionActeDto)
  actes!: ExceptionActeDto[];
}

export class RefuserConventionDto {
  @IsString() @MinLength(5, { message: 'Le motif de refus doit comporter au moins 5 caractères.' }) @MaxLength(500)
  motif!: string;
}

export class NouvelleVersionDto {
  @IsISO8601() dateDebut!: string;
}

export class ArchiverConventionDto {
  @IsOptional() @IsISO8601() dateFin?: string;
}

export class ListerConventionsQueryDto {
  @IsOptional() @IsUUID() etablissementId?: string;
  @IsOptional() @IsString() statut?: string;
}
