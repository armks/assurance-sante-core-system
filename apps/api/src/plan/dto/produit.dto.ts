import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  Max,
  Min,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateGarantieDto } from './garantie.dto';

/** Période de cumul des plafonds annuels (prisma/sql/069). */
export const PERIODES_CUMUL_PLAFOND = ['ANNEE_POLICE', 'ANNEE_CIVILE'] as const;

export class CreateProduitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  nom!: string;

  /** Défaut base : ANNEE_POLICE (année d'anniversaire de la police). */
  @IsOptional()
  @IsIn(PERIODES_CUMUL_PLAFOND)
  periodeCumulPlafond?: (typeof PERIODES_CUMUL_PLAFOND)[number];

  /**
   * Jours après la fin de la police pendant lesquels des soins reçus pendant la
   * couverture peuvent encore être déclarés (défaut base : 90 ; 0 = aucun délai).
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  delaiDeclarationJours?: number;

  /**
   * Catégorie d'établissement la plus haute couverte par la formule (centre médical < hôpital public < clinique < polyclinique).
   * Les niveaux inférieurs sont aussi couverts. Défaut base : POLYCLINIQUE (aucune restriction).
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  niveauAccesEtablissement?: string;

  /** Garanties initiales (optionnel — on peut aussi les ajouter ensuite). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGarantieDto)
  garanties?: CreateGarantieDto[];
}

/**
 * Le produit ne peut être modifié qu'en statut BROUILLON : son nom et la période de
 * cumul de ses plafonds annuels.
 */
export class UpdateProduitDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  nom?: string;

  @IsOptional()
  @IsIn(PERIODES_CUMUL_PLAFOND)
  periodeCumulPlafond?: (typeof PERIODES_CUMUL_PLAFOND)[number];

  /**
   * Jours après la fin de la police pendant lesquels des soins reçus pendant la
   * couverture peuvent encore être déclarés (défaut base : 90 ; 0 = aucun délai).
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  delaiDeclarationJours?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  niveauAccesEtablissement?: string;

  /** Motif — obligatoire pour modifier le niveau d'accès d'une formule PUBLIÉE (seul champ modifiable alors). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motif?: string;
}
