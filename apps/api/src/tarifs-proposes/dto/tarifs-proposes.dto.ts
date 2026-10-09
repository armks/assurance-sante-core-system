import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';
import { MONTANT_PROPOSE_MAX } from '../tarifs-proposes.types';

export class ProposerTarifDto {
  @IsUUID()
  acteDossierId!: string;

  /** Montant TOTAL de l'acte (quantité comprise), en FCFA. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(MONTANT_PROPOSE_MAX)
  montantPropose!: number;

  /** Justification obligatoire (10 caractères au moins). */
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  justification!: string;
}

/** Filtres de la file « Tarifs proposés à examiner » (pagination serveur). */
export class FileTarifsProposesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  etablissementId?: string;

  @IsOptional()
  @IsIn(['PROPOSE', 'VALIDE', 'AJUSTE', 'REFUSE'])
  statut?: string;

  /** Ancienneté minimale, en jours. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  ancienneteMin?: number;

  /** Catégorie de l'acte (catégorie de garantie). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  categorie?: string;
}

export class AjouterConventionDto {
  /** FORFAIT (par unité) ou VALEUR_LETTRE_CLE propre à l'acte (acte coté exigé). */
  @IsIn(['FORFAIT', 'VALEUR_LETTRE_CLE'])
  type!: 'FORFAIT' | 'VALEUR_LETTRE_CLE';
}

export class ValiderTarifDto {
  /** Option « ajouter à la convention » : exception dans une nouvelle version PROPOSEE, à valider par le circuit normal. */
  @IsOptional()
  @ValidateNested()
  @Type(() => AjouterConventionDto)
  ajouterConvention?: AjouterConventionDto;
}

export class AjusterTarifDto extends ValiderTarifDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(MONTANT_PROPOSE_MAX)
  montantDecide!: number;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  motif!: string;
}

export class RefuserTarifDto {
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  motif!: string;

  @IsOptional()
  @IsBoolean()
  confirme?: boolean;
}
