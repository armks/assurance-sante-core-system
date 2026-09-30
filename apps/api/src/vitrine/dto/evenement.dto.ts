import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const nettoyer = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Champs multipart (`FormData`) : les booléens arrivent en chaînes. */
const versBooleen = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === 'on' || value === '1'
    ? true
    : value === false || value === 'false' || value === '0'
      ? false
      : value;

/** Description : chaîne vide → `null` (efface la description en modification). */
const descriptionOuNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};

/**
 * Création d'un événement (multipart : champs texte + fichier `image`, requis
 * à la création — vérifié par le service, le fichier n'étant pas un champ du DTO).
 */
export class CreerEvenementDto {
  @Transform(nettoyer)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  titre!: string;

  @IsOptional()
  @Transform(descriptionOuNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  /** Date AAAA-MM-JJ. */
  @IsDateString({ strict: true }, { message: 'dateEvenement doit être une date AAAA-MM-JJ.' })
  dateEvenement!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  ordreAffichage?: number;

  @IsOptional()
  @Transform(versBooleen)
  @IsBoolean()
  actif?: boolean;
}

/** Modification partielle ; l'image est remplacée seulement si un fichier est joint. */
export class ModifierEvenementDto {
  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  titre?: string;

  @IsOptional()
  @Transform(descriptionOuNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'dateEvenement doit être une date AAAA-MM-JJ.' })
  dateEvenement?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  ordreAffichage?: number;

  @IsOptional()
  @Transform(versBooleen)
  @IsBoolean()
  actif?: boolean;
}

/** Texte facultatif de la bannière : chaîne vide → `null` (retour au texte par défaut). */
const texteOuNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};

/**
 * Bannière de la page /{slug} (multipart : champs + fichier `image` facultatif).
 * Champ absent : inchangé ; champ vide : effacé (valeur par défaut de la plateforme).
 */
export class ModifierHeroDto {
  @IsOptional()
  @Transform(texteOuNull)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  heroTitre?: string | null;

  @IsOptional()
  @Transform(texteOuNull)
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  heroSousTitre?: string | null;

  /** `true` : retire l'image personnalisée (image par défaut de la plateforme). */
  @IsOptional()
  @Transform(versBooleen)
  @IsBoolean()
  supprimerImage?: boolean;
}
