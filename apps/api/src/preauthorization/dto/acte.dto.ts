import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CATEGORIES_ACTE } from '../preauthorization.types';

export class AjouterActeDto {
  @IsIn(CATEGORIES_ACTE)
  categorieActe!: (typeof CATEGORIES_ACTE)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  libelle!: string;

  @IsOptional() @IsString() @MaxLength(40) codeActe?: string;

  @IsOptional() @IsUUID() consultationId?: string;
  @IsOptional() @IsUUID() medecinPrescripteurId?: string;

  @IsOptional() @IsInt() @Min(1) @Max(1000) quantite?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montantPrescrit?: number;

  @IsOptional() @IsString() dateRealisation?: string;
}

export class ValiderPreautorisationDto {
  @IsIn(['APPROUVE', 'REFUSE'])
  decision!: 'APPROUVE' | 'REFUSE';

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  motif!: string;
}
