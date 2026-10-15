import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PLANS_LICENCE } from '../superadmin.types';

export class InitierCreationOrganisationDto {
  @IsString() @MinLength(2) @MaxLength(160)
  nom!: string;

  @IsOptional() @IsString() @MaxLength(200)
  raisonSociale?: string;

  /** Numéro unique de l'assureur (3 à 8 chiffres). Absent : attribué automatiquement à la création. */
  @IsOptional() @Matches(/^[0-9]{3,8}$/, { message: 'Le code assureur doit comporter 3 à 8 chiffres.' })
  codeAssureur?: string;

  @IsIn(['ASSUREUR', 'MUTUELLE'])
  type!: 'ASSUREUR' | 'MUTUELLE';

  @IsString() @MinLength(2) @MaxLength(80)
  pays!: string;

  @IsOptional() @IsString() @MinLength(3) @MaxLength(8)
  devise?: string;

  @IsOptional() @IsIn(PLANS_LICENCE)
  plan?: (typeof PLANS_LICENCE)[number];

  @IsOptional() @IsInt() @Min(0)
  limiteAdherents?: number;

  @IsOptional() @IsInt() @Min(0)
  limiteAppelsApiMois?: number;

  /** date de fin de licence (défaut : +1 an) */
  @IsOptional() @IsDateString()
  dateFin?: string;

  /** premier compte de l'organisation — invité à la confirmation. */
  @IsEmail() @MaxLength(200)
  premierCompteEmail!: string;

  @IsOptional() @IsIn(['ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE'])
  premierCompteRole?: 'ASSUREUR_DIRECTION' | 'ASSUREUR_INFORMATIQUE';
}

export class InitierSuspensionDto {
  @IsOptional() @IsString() @MaxLength(400)
  motif?: string;
}

export class InitierProlongationDto {
  @IsDateString()
  nouvelleDateFin!: string;

  @IsOptional() @IsString() @MaxLength(400)
  motif?: string;
}

export class ConfirmerActionDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{6,8}$/, {
    message: 'Le code doit contenir 6 à 8 caractères alphanumériques.',
  })
  @IsNotEmpty()
  code!: string;
}
