import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FORMAT_CODE_CATEGORIE } from '../../reference/categories-acte.service';
import { RESEAUX_SOINS, ReseauSoins } from '../plan.types';

/** Champs d'une ligne de garantie. Montants en nombres (stockés en Decimal). */
export class CreateGarantieDto {
  /** Code du référentiel `categories_acte` (prisma/sql/067) — existence et
   * statut actif vérifiés par `PlanService` (plus de texte libre). */
  @IsString()
  @Matches(FORMAT_CODE_CATEGORIE, { message: 'categorieActe doit être un code de catégorie (ex. CONSULTATION).' })
  categorieActe!: string;

  /** Obligatoire : plus de taux par défaut implicite (prisma/sql/067). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  tauxCouverture!: number; // %

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  plafondParActe?: number;

  /**
   * Plafond annuel PAR PERSONNE assurée (titulaire ou bénéficiaire), sur la période de
   * cumul du produit. Absent / null = pas de plafond par personne.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  plafondAnnuelPersonne?: number | null;

  /**
   * Plafond annuel PARTAGÉ PAR LA FAMILLE (titulaire + tous ses bénéficiaires). Le plus
   * restrictif des deux plafonds s'applique. Absent / null = pas de plafond familial.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  plafondAnnuelFamille?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  franchise?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  ticketModerateur?: number; // %

  @IsOptional()
  @IsInt()
  @Min(0)
  delaiCarenceJours?: number;

  @IsOptional()
  @IsIn(RESEAUX_SOINS)
  reseauSoins?: ReseauSoins;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  exclusions?: string[];
}

/** Mise à jour partielle d'une garantie (produit BROUILLON uniquement). */
export class UpdateGarantieDto {
  @IsOptional()
  @IsString()
  @Matches(FORMAT_CODE_CATEGORIE, { message: 'categorieActe doit être un code de catégorie (ex. CONSULTATION).' })
  categorieActe?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  tauxCouverture?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  plafondParActe?: number;

  /**
   * Plafond annuel PAR PERSONNE assurée (titulaire ou bénéficiaire), sur la période de
   * cumul du produit. Absent / null = pas de plafond par personne.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  plafondAnnuelPersonne?: number | null;

  /**
   * Plafond annuel PARTAGÉ PAR LA FAMILLE (titulaire + tous ses bénéficiaires). Le plus
   * restrictif des deux plafonds s'applique. Absent / null = pas de plafond familial.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  plafondAnnuelFamille?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  franchise?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  ticketModerateur?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  delaiCarenceJours?: number;

  @IsOptional()
  @IsIn(RESEAUX_SOINS)
  reseauSoins?: ReseauSoins;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  exclusions?: string[];
}

/** Publication d'un produit : catégories actives SANS garantie confirmées
 * « non couvertes » par l'assureur (toutes doivent l'être, prisma/sql/067). */
export class PublierProduitDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(FORMAT_CODE_CATEGORIE, { each: true })
  categoriesNonCouvertes?: string[];
}
