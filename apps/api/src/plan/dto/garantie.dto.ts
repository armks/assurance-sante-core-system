import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RESEAUX_SOINS, ReseauSoins } from '../plan.types';

/** Champs d'une ligne de garantie. Montants en nombres (stockés en Decimal). */
export class CreateGarantieDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  categorieActe!: string; // CONSULTATION, HOSPITALISATION, PHARMACIE, OPTIQUE...

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  tauxCouverture?: number; // %

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  plafondParActe?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  plafondAnnuel?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  franchise?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  ticketModerateur?: number; // %

  @IsOptional()
  @IsInt()
  @Min(0)
  delaiCarenceJours?: number;

  @IsOptional()
  @IsIn(RESEAUX_SOINS)
  reseauSoins?: ReseauSoins;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  exclusions?: string[];
}

/** Mise à jour partielle d'une garantie (produit BROUILLON uniquement). */
export class UpdateGarantieDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  categorieActe?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  tauxCouverture?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  plafondParActe?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  plafondAnnuel?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  franchise?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  ticketModerateur?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  delaiCarenceJours?: number;

  @IsOptional()
  @IsIn(RESEAUX_SOINS)
  reseauSoins?: ReseauSoins;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  exclusions?: string[];
}
