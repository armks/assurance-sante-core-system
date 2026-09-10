import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { STATUTS_HOMOLOGATION, USAGES_MEDICAMENT } from '../../reference/reference.types';

/** Définition / mise à jour d'un paramètre plateforme (valeur JSON arbitraire). */
export class DefinirParametreDto {
  @IsDefined()
  valeur!: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;
}

/** Acte du catalogue national — mêmes champs que ProposerActeDto + statut. */
export class CreerActeNationalDto {
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
  @IsOptional() @IsIn(STATUTS_HOMOLOGATION) statut?: string;
}

/** Médicament du catalogue national — mêmes champs que ProposerMedicamentDto + statut. */
export class CreerMedicamentNationalDto {
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
  @IsOptional() @IsIn(STATUTS_HOMOLOGATION) statut?: string;
}
