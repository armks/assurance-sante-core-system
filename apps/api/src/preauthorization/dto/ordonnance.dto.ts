import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class LigneOrdonnanceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  medicament!: string;

  @IsOptional() @IsString() @MaxLength(80) dosage?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  posologie!: string;

  @IsOptional() @IsString() @MaxLength(80) duree?: string;

  @IsOptional() @IsInt() @Min(1) @Max(1000) quantite?: number;
}

export class CreerOrdonnanceDto {
  @IsUUID()
  consultationId!: string;

  @IsUUID()
  medecinId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LigneOrdonnanceDto)
  lignes!: LigneOrdonnanceDto[];
}

export class ValiderCodeOrdonnanceDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{6,8}$/, {
    message: 'Le code doit contenir 6 à 8 caractères alphanumériques.',
  })
  code!: string;

  @IsUUID()
  pharmacieId!: string;
}

export class DispensationDto {
  @IsIn(['PARTIELLE', 'COMPLETE'])
  type!: 'PARTIELLE' | 'COMPLETE';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  lignesDelivrees?: string[];

  @IsOptional() @IsString() @MaxLength(500) commentaire?: string;
}
