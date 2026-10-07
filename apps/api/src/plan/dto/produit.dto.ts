import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateGarantieDto } from './garantie.dto';

/** Période de cumul des plafonds annuels (prisma/sql/069). */
export const PERIODES_CUMUL_PLAFOND = ['ANNEE_POLICE', 'ANNEE_CIVILE'] as const;

export class CreateProduitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  nom!: string;

  /** Défaut base : ANNEE_POLICE (année d'anniversaire de la police). */
  @IsOptional()
  @IsIn(PERIODES_CUMUL_PLAFOND)
  periodeCumulPlafond?: (typeof PERIODES_CUMUL_PLAFOND)[number];

  /** Garanties initiales (optionnel — on peut aussi les ajouter ensuite). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGarantieDto)
  garanties?: CreateGarantieDto[];
}

/**
 * Le produit ne peut être modifié qu'en statut BROUILLON : son nom et la période de
 * cumul de ses plafonds annuels.
 */
export class UpdateProduitDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  nom?: string;

  @IsOptional()
  @IsIn(PERIODES_CUMUL_PLAFOND)
  periodeCumulPlafond?: (typeof PERIODES_CUMUL_PLAFOND)[number];
}
