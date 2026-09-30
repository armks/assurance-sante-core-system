import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CATEGORIES_PARTENAIRE, TYPES_DEMANDE, type TypeDemande } from '../vitrine.types';

const nettoyer = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Formulaires publics de la page d'accueil : Contact, Devenir partenaire,
 * Adhésion. Un seul DTO, discriminé par `type` : chaque type n'exige que ses
 * propres champs (`ValidateIf`).
 */
export class DemandeVitrineDto {
  @IsIn(TYPES_DEMANDE)
  type!: TypeDemande;

  /** Nom du collectif, de la société ou de l'établissement / pharmacie. */
  @Transform(nettoyer)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  structure!: string;

  /** Nombre estimé d'employés / d'adhérents (Contact, Adhésion). */
  @ValidateIf((d: DemandeVitrineDto) => d.type !== 'PARTENAIRE')
  @Type(() => Number)
  @IsInt({ message: 'Le nombre d’employés ou d’adhérents doit être un nombre entier.' })
  @Min(1)
  @Max(1_000_000)
  effectif?: number;

  /** Devenir partenaire : établissement de santé ou pharmacie. */
  @ValidateIf((d: DemandeVitrineDto) => d.type === 'PARTENAIRE')
  @IsIn(CATEGORIES_PARTENAIRE, { message: 'Précisez s’il s’agit d’un établissement de santé ou d’une pharmacie.' })
  categorie?: (typeof CATEGORIES_PARTENAIRE)[number];

  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @MaxLength(120)
  ville?: string;

  @Transform(nettoyer)
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  @MaxLength(200)
  email!: string;

  @Transform(nettoyer)
  @Matches(/^\+?[\d\s().-]{8,20}$/, { message: 'Numéro de téléphone invalide.' })
  telephone!: string;

  @Transform(nettoyer)
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  objet!: string;

  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @MaxLength(3000)
  message?: string;

  /** Pot de miel : champ caché, jamais rempli par un humain. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  siteWeb?: string;
}

export class InscriptionNewsletterDto {
  @Transform(nettoyer)
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  @MaxLength(200)
  email!: string;

  /** Pot de miel : champ caché, jamais rempli par un humain. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  siteWeb?: string;
}
