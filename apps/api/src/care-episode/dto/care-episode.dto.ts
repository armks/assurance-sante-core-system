import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class OuvrirDossierDto {
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

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  motifConsultation!: string;

  @IsOptional() @IsString() @MaxLength(500) diagnosticEntree?: string;
  @IsOptional() @IsString() @MaxLength(20) codeCim10?: string;
}

export class AjouterConsultationDto {
  @IsUUID()
  medecinId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  motif!: string;

  @IsOptional() @IsString() @MaxLength(2000) observations?: string;
  @IsOptional() @IsString() @MaxLength(500) diagnostic?: string;
  @IsOptional() @IsString() @MaxLength(20) codeCim10?: string;
}

export class ClotureDto {
  @IsOptional() @IsString() @MaxLength(500) motif?: string;
  @IsOptional() @IsString() @MaxLength(20) codeCim10Sortie?: string;
}

export class ClotureForceeDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  motif!: string;
}
