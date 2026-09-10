import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  LIENS_PARENTE,
  MODES_PAIEMENT,
  SEXES,
  STATUTS_MEMBRE,
} from '../member.types';

export class CreateAdherentDto {
  @IsUUID()
  souscripteurId!: string;

  @IsOptional()
  @IsUUID()
  policeId?: string;

  @IsString() @IsNotEmpty() @MaxLength(120) nom!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) prenom!: string;

  @IsDateString()
  dateNaissance!: string;

  @IsIn(SEXES)
  sexe!: string;

  @IsOptional() @IsString() @MaxLength(64) ibanOuRib?: string;
  @IsOptional() @IsString() @MaxLength(120) banqueNom?: string;

  @IsOptional()
  @IsIn(MODES_PAIEMENT)
  modePaiementPrefere?: string;
}

export class UpdateAdherentDto {
  @IsOptional() @IsUUID() policeId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) nom?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) prenom?: string;
  @IsOptional() @IsDateString() dateNaissance?: string;
  @IsOptional() @IsIn(SEXES) sexe?: string;
  @IsOptional() @IsString() @MaxLength(64) ibanOuRib?: string;
  @IsOptional() @IsString() @MaxLength(120) banqueNom?: string;
  @IsOptional() @IsIn(MODES_PAIEMENT) modePaiementPrefere?: string;
}

export class CreateBeneficiaireDto {
  @IsIn(LIENS_PARENTE)
  lienParente!: string;

  @IsString() @IsNotEmpty() @MaxLength(120) nom!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) prenom!: string;

  @IsDateString()
  dateNaissance!: string;

  @IsIn(SEXES)
  sexe!: string;
}

export class UpdateBeneficiaireDto {
  @IsOptional() @IsIn(LIENS_PARENTE) lienParente?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) nom?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) prenom?: string;
  @IsOptional() @IsDateString() dateNaissance?: string;
  @IsOptional() @IsIn(SEXES) sexe?: string;
}

export class ChangerStatutDto {
  @IsIn(STATUTS_MEMBRE)
  statut!: string;

  @IsOptional() @IsString() @MaxLength(400) motif?: string;
}
