import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class RechercherParCarteQueryDto {
  @IsString()
  @IsNotEmpty()
  numeroCarte!: string;
}

export class LigneChoisieDto {
  @IsUUID()
  ligneOrdonnanceId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantite?: number;
}

export class PreparerDispensationDto {
  @IsUUID()
  ordonnanceId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LigneChoisieDto)
  lignes!: LigneChoisieDto[];
}

export class ValiderCodeDispensationDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{6,8}$/, {
    message: 'Le code doit contenir 6 à 8 caractères alphanumériques.',
  })
  code!: string;
}

export class DefinirPrixStockDto {
  @IsString()
  @IsNotEmpty()
  denominationMedicament!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  prixPharmacie?: number;

  @IsOptional()
  @IsBoolean()
  disponible?: boolean;
}
