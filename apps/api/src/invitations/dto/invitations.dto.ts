import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreerInvitationDto {
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telephone?: string;

  /** code sous_roles (ex: ASSUREUR_INFORMATIQUE). */
  @IsString()
  @MaxLength(64)
  rolePropose!: string;

  /** Requis quand le rôle créateur n'a pas de scope (superadmin → compte assureur). */
  @IsOptional()
  @IsUUID()
  organisationId?: string;

  @IsOptional()
  @IsUUID()
  societeId?: string;

  @IsOptional()
  @IsUUID()
  etablissementId?: string;

  @IsOptional()
  @IsUUID()
  pharmacieId?: string;

  @IsOptional()
  @IsUUID()
  adherentId?: string;
}

export class AccepterInvitationDto {
  @IsString()
  @MinLength(24)
  @MaxLength(128)
  token!: string;

  /** Défini par l'invité lui-même — transite vers l'API Admin Supabase sans être stocké. */
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/[0-9]/, { message: 'Le mot de passe doit contenir au moins un chiffre.' })
  @Matches(/[A-Za-z]/, { message: 'Le mot de passe doit contenir au moins une lettre.' })
  motDePasse!: string;
}

export class RejeterInvitationDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  motif?: string;
}
