import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { TYPES_LICENCE, type TypeLicence } from './licence-etat';

export class ActiverLicenceDto {
  /** Code d'activation transmis par le superadmin (les séparateurs éventuels sont ignorés). */
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9 -]{6,40}$/, { message: 'Le code d’activation est invalide.' })
  code!: string;
}

export class TypeLicenceDto {
  @IsIn(TYPES_LICENCE)
  typeLicence!: TypeLicence;
}

export class EnvoyerCodeDto {
  /** Destinataire du code : l'adresse de la société d'assurance ou le(s) directeur(s) de l'assurance. */
  @IsIn(['SOCIETE', 'DIRECTEUR'])
  cible!: 'SOCIETE' | 'DIRECTEUR';
}

export class EmailSocieteDto {
  /** Adresse e-mail de la société d'assurance (destinataire possible du code d'activation). */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  @MaxLength(254)
  email!: string;
}

export class HistoriqueLicencesQueryDto {
  /** Date de génération, bornes incluses. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'du doit être une date AAAA-MM-JJ' })
  du?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'au doit être une date AAAA-MM-JJ' })
  au?: string;

  @IsOptional()
  @IsUUID()
  organisationId?: string;

  @IsOptional()
  @IsIn(TYPES_LICENCE)
  typeLicence?: TypeLicence;

  @IsOptional()
  @IsIn(['EMIS', 'ACTIVE', 'EXPIRE', 'ANNULE'])
  statut?: 'EMIS' | 'ACTIVE' | 'EXPIRE' | 'ANNULE';

  @IsOptional()
  @IsIn(['CODE', 'DIRECTE'])
  mode?: 'CODE' | 'DIRECTE';
}

export class PrixLicenceDto {
  /** Prix en FCFA (0 pour l'essai gratuit). */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  prix!: number;
}
