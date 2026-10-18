import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, Matches, MaxLength } from 'class-validator';
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
