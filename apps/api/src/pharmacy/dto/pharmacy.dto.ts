import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { STATUTS_DISPENSATION } from '../pharmacy.types';

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

export class ListerDispensationsQueryDto {
  @IsOptional()
  @IsIn(STATUTS_DISPENSATION)
  statut?: (typeof STATUTS_DISPENSATION)[number];
}

export class SubstituerMedicamentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nouveauMedicament!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  motif!: string;
}

export class SoumettreFactureMensuelleDto {
  /** Premier jour du mois précédent — 'YYYY-MM-DD'. Toute autre date est refusée. */
  @Matches(/^\d{4}-\d{2}-01$/, {
    message: "periode doit être le premier jour d'un mois, au format YYYY-MM-01.",
  })
  periode!: string;
}
