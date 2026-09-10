import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DECISIONS_REVUE_MANUELLE, TYPES_RECLAMATION } from '../claims.types';

/**
 * Soumission d'une réclamation à l'adjudication. La réclamation est construite à
 * partir de l'acte de dossier ; `garantieId` / `montant` ne servent qu'en
 * secours si le dossier n'a pas de plan de couverture / l'acte pas de montant.
 */
export class SoumettreReclamationDto {
  @IsUUID()
  acteDossierId!: string;

  @IsOptional()
  @IsIn(TYPES_RECLAMATION)
  typeReclamation?: (typeof TYPES_RECLAMATION)[number];

  @IsOptional()
  @IsUUID()
  garantieId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montant?: number;
}

/**
 * Décision de revue manuelle d'une réclamation `REVUE_MANUELLE`. `montantAjuste`
 * ne s'applique qu'à une approbation (sinon le remboursement est mis à 0).
 */
export class ValiderManuellementDto {
  @IsIn(DECISIONS_REVUE_MANUELLE)
  decision!: (typeof DECISIONS_REVUE_MANUELLE)[number];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montantAjuste?: number;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  motif!: string;
}
