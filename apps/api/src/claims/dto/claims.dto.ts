import { IsIn, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { TYPES_RECLAMATION } from '../claims.types';

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
