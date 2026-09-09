import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Mise à jour partielle d'un souscripteur. Le `type` (segment) n'est pas
 * modifiable ici, et les membres de comité se gèrent via leurs propres endpoints.
 */
export class UpdateSouscripteurDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  secteurActivite?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  effectifDeclare?: number;

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

  @IsOptional()
  @IsString()
  @MaxLength(120)
  numeroPieceIdentite?: string;

  @IsOptional()
  @IsUUID()
  questionnaireMedicalId?: string;
}
