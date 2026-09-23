import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateGrilleDto {
  @IsUUID()
  produitId!: string;

  @IsInt()
  @Min(0)
  @Max(150)
  trancheAgeMin!: number;

  @IsInt()
  @Min(0)
  @Max(150)
  trancheAgeMax!: number;

  /** null / absent = tarif STANDARD ; renseigné = tarif NÉGOCIÉ pour ce souscripteur. */
  @IsOptional()
  @IsUUID()
  souscripteurId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montantMensuel!: number;
}

export class CalculerCotisationDto {
  @IsUUID()
  policeId!: string;

  @IsISO8601()
  periode!: string;

  @IsInt()
  @Min(0)
  @Max(150)
  age!: number;
}

class AdherentCotisationDto {
  @IsUUID()
  adherentId!: string;

  @IsInt()
  @Min(0)
  @Max(150)
  age!: number;
}

export class GenererCotisationsDto {
  @IsISO8601()
  periode!: string;

  @IsOptional()
  @IsISO8601()
  dateEcheance?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdherentCotisationDto)
  adherents!: AdherentCotisationDto[];
}

export class EnregistrerPaiementDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montant!: number;
}

export class ConsoliderFactureSocieteDto {
  @IsISO8601()
  periode!: string;

  @IsOptional()
  @IsISO8601()
  dateEcheance?: string;
}
