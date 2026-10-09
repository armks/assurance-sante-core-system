import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { STATUTS_POLICE, TYPES_AVENANT } from '../policy.types';

export class CreateDevisDto {
  @IsUUID()
  souscripteurId!: string;

  @IsUUID()
  produitId!: string;

  @IsOptional()
  @IsISO8601()
  dateDebut?: string;

  @IsOptional()
  @IsISO8601()
  dateFin?: string;
}

export class SouscrireDto {
  @IsOptional()
  @IsISO8601()
  dateDebut?: string;

  @IsOptional()
  @IsISO8601()
  dateFin?: string;
}

export class ChangerStatutDto {
  @IsIn(STATUTS_POLICE)
  statut!: (typeof STATUTS_POLICE)[number];
}

/** Aperçu de proratisation avant confirmation — ne persiste rien. */
export class SimulerAvenantDto {
  @IsIn(TYPES_AVENANT)
  type!: (typeof TYPES_AVENANT)[number];

  @IsISO8601()
  dateEffet!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  tarifMensuelFormule?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  impactCotisation?: number;
}

export class CreateAvenantDto {
  @IsIn(TYPES_AVENANT)
  type!: (typeof TYPES_AVENANT)[number];

  @IsISO8601()
  dateEffet!: string;

  /**
   * Tarif mensuel de la formule à proratiser. Si fourni, PolicyService calcule
   * `impact_cotisation = tarifMensuelFormule × jours_restants / jours_total` et
   * pose `proratisation_appliquee = true`. Peut être négatif (radiation).
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  tarifMensuelFormule?: number;

  /** Impact déjà chiffré (utilisé si tarifMensuelFormule n'est pas fourni). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  impactCotisation?: number;
}

/** Modification libre d'une police AU STADE DU DEVIS (le souscripteur ne change pas). */
export class UpdatePoliceDto {
  @IsOptional()
  @IsUUID()
  produitId?: string;

  @IsOptional()
  @IsISO8601()
  dateDebut?: string;

  @IsOptional()
  @IsISO8601()
  dateFin?: string;
}

/** Modification d'un avenant en BROUILLON (type et date d'effet ; impact recalculé). */
export class UpdateAvenantDto {
  @IsOptional()
  @IsIn(TYPES_AVENANT)
  type?: (typeof TYPES_AVENANT)[number];

  @IsOptional()
  @IsISO8601()
  dateEffet?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  tarifMensuelFormule?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  impactCotisation?: number;
}

/** Annulation d'un avenant APPLIQUE : motif OBLIGATOIRE (tracé), jamais de suppression. */
export class AnnulerMotifDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5, { message: 'Le motif doit comporter au moins 5 caractères.' })
  @MaxLength(500)
  motif!: string;
}
