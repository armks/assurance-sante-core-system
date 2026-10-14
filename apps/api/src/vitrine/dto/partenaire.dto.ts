import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const nettoyer = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Champs multipart (`FormData`) : les booléens arrivent en chaînes. */
const versBooleen = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === 'on' || value === '1'
    ? true
    : value === false || value === 'false' || value === '0'
      ? false
      : value;

/** Site du partenaire : adresse http(s) (jamais `javascript:` ni autre schéma) ; chaîne vide = pas de lien. */
const SITE = /^$|^https?:\/\/[^\s]{3,290}$/i;

/** Ajout d'un partenaire (multipart : champs texte + fichier `image` — le logo —, requis, vérifié par le service). */
export class CreerPartenaireDto {
  @Transform(nettoyer)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nom!: string;

  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @Matches(SITE, { message: 'Le site doit être une adresse commençant par http:// ou https://.' })
  siteUrl?: string;

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

/** Modification : tous les champs facultatifs ; logo remplacé si un fichier `image` est joint. */
export class ModifierPartenaireDto {
  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nom?: string;

  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @Matches(SITE, { message: 'Le site doit être une adresse commençant par http:// ou https://.' })
  siteUrl?: string;

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
