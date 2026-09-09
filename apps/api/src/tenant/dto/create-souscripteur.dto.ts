import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TYPES_SOUSCRIPTEUR, TypeSouscripteur } from '../tenant.types';

/** Membre de comité fourni à la création d'un souscripteur COLLECTIVITE. */
export class MembreComiteInlineDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fonction!: string; // Président, Trésorier, Secrétaire, ...

  @IsOptional()
  @IsString()
  dateDebutMandat?: string; // ISO date (YYYY-MM-DD)

  @IsOptional()
  @IsString()
  dateFinMandat?: string;
}

export class CreateSouscripteurDto {
  @IsIn(TYPES_SOUSCRIPTEUR)
  type!: TypeSouscripteur;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nom!: string;

  // --- segment ENTREPRISE ---
  @IsOptional()
  @IsString()
  @MaxLength(255)
  secteurActivite?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  effectifDeclare?: number;

  // --- segment COLLECTIVITE ---
  @IsOptional()
  @IsString()
  @MaxLength(120)
  typeCollectivite?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  organeGouvernance?: string;

  @IsOptional()
  @IsBoolean()
  subventionExterne?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  bailleurSubvention?: string;

  // --- segment INDIVIDUEL ---
  @IsOptional()
  @IsString()
  @MaxLength(120)
  numeroPieceIdentite?: string;

  @IsOptional()
  @IsUUID()
  questionnaireMedicalId?: string;

  /** Uniquement pour type === COLLECTIVITE (v9 §1.3). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MembreComiteInlineDto)
  membresComite?: MembreComiteInlineDto[];
}
