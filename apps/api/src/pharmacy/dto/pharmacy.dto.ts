import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PeriodeQueryDto, RecherchePeriodeQueryDto } from '../../common/pagination';
import { DECISIONS_VALIDATION_FACTURE_MENSUELLE_PHARMACIE, STATUTS_DISPENSATION } from '../pharmacy.types';

export class RechercherParCarteQueryDto {
  @IsString()
  @IsNotEmpty()
  numeroCarte!: string;
}

export class LigneChoisieDto {
  @IsUUID()
  ligneOrdonnanceId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantite?: number;

  /** Prix unitaire PRATIQUÉ par la pharmacie, saisi par le caissier (majoration comprise). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  prixUnitaire!: number;
}

export class PreparerDispensationDto {
  @IsUUID()
  ordonnanceId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LigneChoisieDto)
  lignes!: LigneChoisieDto[];

  /** Canal d'envoi du code au patient (contact enregistré sur sa fiche). */
  @IsOptional()
  @IsIn(['EMAIL', 'SMS'])
  canal?: 'EMAIL' | 'SMS';
}

export class ValiderCodeDispensationDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{6,8}$/, {
    message: 'Le code doit contenir 6 à 8 caractères alphanumériques.',
  })
  code!: string;
}

/**
 * Disponibilité d'un médicament : le médicament est CHOISI dans la base (`medicamentId` = catalogue national activé par l'assureur).
 * `denominationMedicament` ne sert qu'à mettre à jour une ligne de stock déjà existante (ancienne saisie libre) ; jamais à en créer.
 */
export class DefinirPrixStockDto {
  @IsOptional()
  @IsUUID()
  medicamentId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  denominationMedicament?: string;

  @IsOptional()
  @IsBoolean()
  disponible?: boolean;
}

/**
 * Dispensations de la pharmacie : pagination serveur (remplace `take: 100`),
 * statut, période de préparation, recherche (patient, n° de carte, médicament
 * — sans accent).
 */
export class ListerDispensationsQueryDto extends RecherchePeriodeQueryDto {
  @IsOptional()
  @IsIn(STATUTS_DISPENSATION)
  statut?: (typeof STATUTS_DISPENSATION)[number];

  /** N° de carte du patient (contient, casse ignorée). */
  @IsOptional() @IsString() @MaxLength(60) carte?: string;
  /** Société (souscripteur) de l'adhérent (contient). */
  @IsOptional() @IsString() @MaxLength(100) societe?: string;
  /** Formule d'assurance (produit de la police, contient). */
  @IsOptional() @IsString() @MaxLength(100) formule?: string;
  /** `1` : exclut les factures annulées (suivi / récapitulatif). */
  @IsOptional() @IsIn(['1']) horsAnnulees?: '1';
}

/** Dispensations de l'adhérent : pagination serveur (remplace `take: 50`), statut, période. */
export class ListerMesDispensationsQueryDto extends PeriodeQueryDto {
  @IsOptional()
  @IsIn(STATUTS_DISPENSATION)
  statut?: (typeof STATUTS_DISPENSATION)[number];

  /** N° de carte du titulaire ou d'un bénéficiaire (contient, casse ignorée). */
  @IsOptional() @IsString() @MaxLength(60) carte?: string;
}

/**
 * Nouveau médicament ajouté au catalogue national par le pharmacien, avec son PRIX NATIONAL (obligatoire). Le taux de remboursement et
 * le plafond ne sont pas du ressort de la pharmacie : ils se règlent par les garanties de l'assureur.
 */
export class CreerMedicamentCatalogueDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  denominationCommune!: string;

  @IsOptional() @IsString() @MaxLength(200) nomCommercial?: string;
  @IsOptional() @IsString() @MaxLength(80) dosage?: string;
  @IsOptional() @IsString() @MaxLength(120) forme?: string;
  @IsOptional() @IsString() @MaxLength(200) classeTherapeutique?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  prixReferenceXof!: number;
}

/** Mise à jour d'un médicament de la liste de la pharmacie : disponibilité et/ou note. Aucun tarif. */
export class ModifierMedicamentListeDto {
  @IsOptional()
  @IsBoolean()
  disponible?: boolean;

  /** Note libre (200 caractères max) ; chaîne vide = l'effacer. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class SubstituerMedicamentDto {
  /** Médicament de remplacement CHOISI dans la base (catalogue national homologué et activé par l'assureur). */
  @IsUUID()
  nouveauMedicamentId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  motif!: string;
}

export class SoumettreFactureMensuelleDto {
  /** Premier jour du mois précédent — 'YYYY-MM-DD'. Toute autre date est refusée. */
  @Matches(/^\d{4}-\d{2}-01$/, {
    message: "periode doit être le premier jour d'un mois, au format YYYY-MM-01.",
  })
  periode!: string;
}

export class ValiderFactureMensuelleDto {
  @IsIn(DECISIONS_VALIDATION_FACTURE_MENSUELLE_PHARMACIE)
  decision!: (typeof DECISIONS_VALIDATION_FACTURE_MENSUELLE_PHARMACIE)[number];
}
