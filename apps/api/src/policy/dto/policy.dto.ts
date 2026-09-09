import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsUUID,
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
