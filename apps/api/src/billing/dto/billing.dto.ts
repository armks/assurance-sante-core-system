import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** `POST billing/grilles-tarifaires/ajuster` — hausse (+) ou baisse (−) en pourcentage de toutes les grilles d'une formule. */
export class AjusterGrillesDto {
  @IsUUID()
  produitId!: string;

  /** Pourcentage appliqué aux montants mensuels : 10 = +10 %, −15 = −15 %. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-90)
  @Max(500)
  pourcentage!: number;

  /** Limite l'ajustement à la grille négociée d'une société (sinon toutes les grilles de la formule). */
  @IsOptional()
  @IsUUID()
  souscripteurId?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  motif!: string;
}

export class CreateGrilleDto {
  @IsUUID()
  produitId!: string;

  @IsInt()
  @Min(0)
  @Max(150)
  trancheAgeMin!: number;

  @IsInt()
  @Min(0)
  @Max(150)
  trancheAgeMax!: number;

  /** null / absent = tarif STANDARD ; renseigné = tarif NÉGOCIÉ pour ce souscripteur. */
  @IsOptional()
  @IsUUID()
  souscripteurId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montantMensuel!: number;
}

/**
 * Modification d'une grille (ADR-007) : permise même si la grille a déjà servi —
 * chaque cotisation garde le montant calculé à sa date ; seule la suppression exige
 * qu'elle n'ait jamais servi.
 */
export class UpdateGrilleDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(150)
  trancheAgeMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(150)
  trancheAgeMax?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montantMensuel?: number;
}

export class CalculerCotisationDto {
  @IsUUID()
  policeId!: string;

  @IsISO8601()
  periode!: string;

  @IsInt()
  @Min(0)
  @Max(150)
  age!: number;
}

class AdherentCotisationDto {
  @IsUUID()
  adherentId!: string;

  @IsInt()
  @Min(0)
  @Max(150)
  age!: number;
}

export class GenererCotisationsDto {
  @IsISO8601()
  periode!: string;

  @IsOptional()
  @IsISO8601()
  dateEcheance?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdherentCotisationDto)
  adherents!: AdherentCotisationDto[];
}

export class EnregistrerPaiementDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montant!: number;
}

export class ConsoliderFactureSocieteDto {
  @IsISO8601()
  periode!: string;

  @IsOptional()
  @IsISO8601()
  dateEcheance?: string;
}

/** Annulation d'une cotisation A_PAYER sans paiement : motif OBLIGATOIRE (tracé), jamais de suppression. */
export class AnnulerCotisationDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5, { message: 'Le motif doit comporter au moins 5 caractères.' })
  @MaxLength(500)
  motif!: string;
}
