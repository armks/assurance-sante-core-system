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
import { DECISIONS_REVUE_MANUELLE } from '../claims.types';

/**
 * Soumission d'une réclamation à l'adjudication. La réclamation est construite à
 * partir de l'acte de dossier : la garantie est celle du produit pour la
 * CATÉGORIE de l'acte, le type de réclamation vient du référentiel
 * `categories_acte` (prisma/sql/067) — ni l'un ni l'autre n'est fourni par le
 * client. `montant` ne sert qu'en secours si l'acte n'a pas de montant.
 */
export class SoumettreReclamationDto {
  @IsUUID()
  acteDossierId!: string;

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
