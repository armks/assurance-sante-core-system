import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

/** Création d'une annonce du bandeau défilant. */
export class CreerAnnonceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  texte!: string;

  /** Durée d'affichage du bandeau, en secondes (5 à 600) ; défaut 30. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(600)
  dureeAffichageSecondes?: number;

  /** Début de diffusion (défaut : maintenant). */
  @IsOptional()
  @IsISO8601()
  dateDebut?: string;

  /** Fin de diffusion (facultative) : au-delà, l'annonce n'est plus servie. */
  @IsOptional()
  @IsISO8601()
  dateFin?: string;

  @IsOptional()
  @IsBoolean()
  actif?: boolean;

  /** SUPERADMIN uniquement : société visée. Absent avec `toutesLesPages` = diffusion sur toutes les pages d'accueil. */
  @IsOptional()
  @IsUUID()
  organisationId?: string;

  /** SUPERADMIN uniquement : diffuser sur toutes les pages d'accueil de la plateforme. */
  @IsOptional()
  @IsBoolean()
  toutesLesPages?: boolean;
}

export class ModifierAnnonceDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  texte?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(600)
  dureeAffichageSecondes?: number;

  @IsOptional()
  @IsISO8601()
  dateDebut?: string;

  /** `null` efface la date de fin. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  dateFin?: string | null;

  @IsOptional()
  @IsBoolean()
  actif?: boolean;
}
