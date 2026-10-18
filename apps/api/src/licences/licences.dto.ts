import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
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
