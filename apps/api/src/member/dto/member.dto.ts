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

/** Proposition d'ajout d'un adhérent PRINCIPAL par une société cliente —
 * validation structurelle seulement (format email/téléphone, doublons)
 * appliquée côté service, même règles que l'import Excel. */
export class ProposerAdherentDto {
  @IsString() @IsNotEmpty() @MaxLength(120) nom!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) prenom!: string;
  @IsString() @IsNotEmpty() @MaxLength(20) telephone!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) email!: string;
  @IsDateString() dateNaissance!: string;
}

/** Proposition d'ajout d'un bénéficiaire par une société cliente, rattaché à
 * un adhérent EXISTANT de sa propre société. */
export class ProposerBeneficiaireDto {
  @IsUUID() adherentId!: string;
  @IsIn(LIENS_PARENTE) lienParente!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) nom!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) prenom!: string;
  @IsDateString() dateNaissance!: string;
  @IsIn(SEXES) sexe!: string;
}
