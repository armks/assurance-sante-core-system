import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { USAGES_MEDICAMENT } from '../reference.types';

export class ProposerActeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  libelle!: string;

  @IsOptional() @IsString() @MaxLength(120) categorie?: string;
  @IsOptional() @IsString() @MaxLength(40) versionNomenclature?: string;
}

export class ProposerMedicamentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  denominationCommune!: string;

  @IsOptional() @IsString() @MaxLength(200) nomCommercial?: string;
  @IsOptional() @IsString() @MaxLength(20) codeEan?: string;
  @IsOptional() @IsString() @MaxLength(120) forme?: string;
  @IsOptional() @IsString() @MaxLength(80) dosage?: string;
  @IsOptional() @IsString() @MaxLength(120) conditionnement?: string;
  @IsOptional() @IsString() @MaxLength(200) classeTherapeutique?: string;

  @IsOptional() @IsBoolean() remboursable?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) tauxRemboursementStd?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) prixReferenceXof?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) prixMaxRemboursable?: number;
  @IsOptional() @IsBoolean() medicamentEssentiel?: boolean;
  @IsOptional() @IsBoolean() generiqueDisponible?: boolean;
  @IsOptional() @IsBoolean() ordonnanceObligatoire?: boolean;
  @IsOptional() @IsBoolean() medicamentControle?: boolean;
  @IsOptional() @IsIn(USAGES_MEDICAMENT) usage?: (typeof USAGES_MEDICAMENT)[number];
}

/** Activation / désactivation en masse : une liste d'identifiants du catalogue national OU « tous » (tout le catalogue homologué). */
export class ActivationMasseDto {
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids?: string[];
  @IsOptional() @IsBoolean() tous?: boolean;
  @IsBoolean() actif!: boolean;
}

export class MotifDto {
  @IsOptional() @IsString() @MaxLength(400) motif?: string;
}

/** Champs métier renseignés à l'homologation d'un médicament (prix, taux…). */
export class HomologuerMedicamentDto {
  @IsOptional() @IsBoolean() remboursable?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) tauxRemboursementStd?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) prixReferenceXof?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) prixMaxRemboursable?: number;
}
