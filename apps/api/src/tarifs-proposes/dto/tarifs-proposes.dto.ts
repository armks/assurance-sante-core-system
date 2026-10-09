import { Type } from 'class-transformer';
import { IsNumber, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
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
