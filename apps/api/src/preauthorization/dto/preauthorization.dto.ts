import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class GenererCodeConsultationDto {
  @IsOptional()
  @IsUUID()
  adherentId?: string;

  @IsOptional()
  @IsUUID()
  beneficiaireId?: string;

  @IsUUID()
  etablissementId!: string;

  @IsUUID()
  policeId!: string;
}

export class ValiderCodeConsultationDto {
  /** Code saisi par l'établissement (6 à 8 caractères alphanumériques majuscules). */
  @IsString()
  @Matches(/^[A-Za-z0-9]{6,8}$/, {
    message: 'Le code doit contenir 6 à 8 caractères alphanumériques.',
  })
  code!: string;

  @IsUUID()
  etablissementId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  motifConsultation!: string;

  @IsOptional() @IsString() @MaxLength(500) diagnosticEntree?: string;
  @IsOptional() @IsString() @MaxLength(20) codeCim10?: string;
}
