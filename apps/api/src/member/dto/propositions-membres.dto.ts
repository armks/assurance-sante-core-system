import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { LIENS_PARENTE, SEXES } from '../member.types';

export const STATUTS_PROPOSITION_MEMBRE = ['EN_ATTENTE', 'VALIDEE', 'REJETEE', 'RETIREE'] as const;

/** Proposition d'adhérent : formule (police), sexe et au moins un contact (téléphone ou e-mail) sont obligatoires. */
export class ProposerAdherentMembreDto {
  @IsString({ message: 'nom est requis.' }) @IsNotEmpty({ message: 'nom est requis.' }) @MaxLength(120) nom!: string;
  @IsString({ message: 'prenom est requis.' }) @IsNotEmpty({ message: 'prenom est requis.' }) @MaxLength(120) prenom!: string;
  @IsDateString({}, { message: 'dateNaissance doit être une date valide.' }) dateNaissance!: string;
  @IsIn(SEXES, { message: 'sexe doit être M ou F.' }) sexe!: string;
  @IsUUID('all', { message: 'policeId (formule rattachée) est requis.' }) policeId!: string;
  @IsOptional() @IsString() @MaxLength(20) telephone?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  /** Entrant : mois d'effet (n'importe quel jour du mois, ramené au 1er) — vide = effet immédiat à la validation. */
  @IsOptional() @IsDateString({}, { message: 'moisEffet doit être une date valide.' }) moisEffet?: string;
}

export class ProposerBeneficiaireMembreDto {
  @IsUUID('all', { message: 'adherentId est requis.' }) adherentId!: string;
  @IsIn(LIENS_PARENTE, { message: 'lienParente invalide.' }) lienParente!: string;
  @IsString({ message: 'nom est requis.' }) @IsNotEmpty({ message: 'nom est requis.' }) @MaxLength(120) nom!: string;
  @IsString({ message: 'prenom est requis.' }) @IsNotEmpty({ message: 'prenom est requis.' }) @MaxLength(120) prenom!: string;
  @IsDateString({}, { message: 'dateNaissance doit être une date valide.' }) dateNaissance!: string;
  @IsIn(SEXES, { message: 'sexe doit être M ou F.' }) sexe!: string;
  /** Facultatifs pour un bénéficiaire (formats contrôlés par le service). */
  @IsOptional() @IsString() @MaxLength(20) telephone?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
}

export class RejeterPropositionMembreDto {
  @IsString({ message: 'motif est requis.' }) @IsNotEmpty({ message: 'motif est requis.' }) @MaxLength(400) motif!: string;
}

export class ListerPropositionsMembresQueryDto {
  @IsOptional() @IsIn(STATUTS_PROPOSITION_MEMBRE, { message: 'statut invalide.' }) statut?: (typeof STATUTS_PROPOSITION_MEMBRE)[number];
  @IsOptional() @IsIn(['ADHERENT', 'BENEFICIAIRE']) type?: 'ADHERENT' | 'BENEFICIAIRE';
  @IsOptional() @IsUUID() souscripteurId?: string;
}
