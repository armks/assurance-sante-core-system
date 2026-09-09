import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Création d'une organisation (tenant racine) — réservé au superadministrateur. */
export class CreerOrganisationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  nom!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  raisonSociale?: string;

  @IsIn(['ASSUREUR', 'MUTUELLE'])
  type!: 'ASSUREUR' | 'MUTUELLE';

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  pays!: string;

  /** Code devise ISO (défaut XOF). */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(8)
  devise?: string;
}
