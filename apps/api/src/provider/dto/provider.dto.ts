import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CIBLES_RECHERCHE,
  METHODES_VERIFICATION,
  STATUTS_ETABLISSEMENT,
  STATUTS_PHARMACIE,
  STATUTS_VERIFICATION,
  TYPES_ETABLISSEMENT,
} from '../provider.types';

class BaseLieuDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nom!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @IsOptional() @IsString() @MaxLength(80) pays?: string;
  @IsOptional() @IsString() @MaxLength(120) ville?: string;
  @IsOptional() @IsString() @MaxLength(120) commune?: string;
  @IsOptional() @IsString() @MaxLength(120) quartier?: string;
  @IsOptional() @IsString() @MaxLength(400) adresseComplete?: string;

  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;

  @IsOptional() @IsString() @MaxLength(40) telephone?: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;

  @IsOptional() @IsBoolean() gardeWeekend?: boolean;
  @IsOptional() @IsObject() horairesGarde?: Record<string, unknown>;
  @IsOptional() @IsBoolean() tiersPayant?: boolean;

  @IsOptional() @IsString() dateConvention?: string;
  @IsOptional() @IsString() dateFinConvention?: string;
}

export class CreateEtablissementDto extends BaseLieuDto {
  @IsIn(TYPES_ETABLISSEMENT)
  typeEtablissement!: (typeof TYPES_ETABLISSEMENT)[number];

  @IsOptional() @IsString() @MaxLength(40) telephoneUrgence?: string;
  @IsOptional() @IsObject() horairesSemaine?: Record<string, unknown>;

  @IsOptional() @IsIn(STATUTS_ETABLISSEMENT) statut?: string;
}

export class UpdateEtablissementDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) nom?: string;
  @IsOptional() @IsIn(TYPES_ETABLISSEMENT) typeEtablissement?: string;
  @IsOptional() @IsString() @MaxLength(120) ville?: string;
  @IsOptional() @IsString() @MaxLength(120) commune?: string;
  @IsOptional() @IsString() @MaxLength(120) quartier?: string;
  @IsOptional() @IsString() @MaxLength(400) adresseComplete?: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  @IsOptional() @IsString() @MaxLength(40) telephone?: string;
  @IsOptional() @IsString() @MaxLength(40) telephoneUrgence?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsIn(STATUTS_ETABLISSEMENT) statut?: string;
  @IsOptional() @IsString() dateConvention?: string;
  @IsOptional() @IsString() dateFinConvention?: string;
  @IsOptional() @IsBoolean() gardeWeekend?: boolean;
  @IsOptional() @IsObject() horairesGarde?: Record<string, unknown>;
  @IsOptional() @IsObject() horairesSemaine?: Record<string, unknown>;
  @IsOptional() @IsBoolean() tiersPayant?: boolean;
}

export class CreatePharmacieDto extends BaseLieuDto {
  @IsOptional() @IsIn(STATUTS_PHARMACIE) statut?: string;
}

export class UpdatePharmacieDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) nom?: string;
  @IsOptional() @IsString() @MaxLength(120) ville?: string;
  @IsOptional() @IsString() @MaxLength(120) commune?: string;
  @IsOptional() @IsString() @MaxLength(120) quartier?: string;
  @IsOptional() @IsString() @MaxLength(400) adresseComplete?: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  @IsOptional() @IsString() @MaxLength(40) telephone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsIn(STATUTS_PHARMACIE) statut?: string;
  @IsOptional() @IsString() dateConvention?: string;
  @IsOptional() @IsString() dateFinConvention?: string;
  @IsOptional() @IsBoolean() gardeWeekend?: boolean;
  @IsOptional() @IsObject() horairesGarde?: Record<string, unknown>;
  @IsOptional() @IsBoolean() tiersPayant?: boolean;
}

/** Recherche géolocalisée (query params castés en nombres via `transform`). */
export class RechercheGeoDto {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  /** Rayon en kilomètres (défaut 5, max 200). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(200)
  rayonKm?: number;

  @IsOptional()
  @IsIn(CIBLES_RECHERCHE)
  cible?: (typeof CIBLES_RECHERCHE)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite?: number;
}

/** Enregistre une vérification terrain d'un établissement ou d'une pharmacie (v8 §9). */
export class EnregistrerVerificationDto {
  @IsIn(METHODES_VERIFICATION)
  methode!: (typeof METHODES_VERIFICATION)[number];

  @IsIn(STATUTS_VERIFICATION)
  statutConfirme!: (typeof STATUTS_VERIFICATION)[number];

  @IsOptional() @IsString() @MaxLength(500) commentaire?: string;
}

/** Marque « A_REVERIFIER » les entrées non vérifiées depuis plus de `moisMax` mois. */
export class ReverifierObsoletesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  moisMax?: number;
}
