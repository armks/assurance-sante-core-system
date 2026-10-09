import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  BENEFICIAIRE_TYPES_PAIEMENT_GROUPE,
  SOURCES_APPROVISIONNEMENT,
  TYPES_COMPTE_FINANCIER,
} from '../payment.types';

export class AssocierFacturesPourPaiementDto {
  @IsIn(BENEFICIAIRE_TYPES_PAIEMENT_GROUPE)
  beneficiaireType!: (typeof BENEFICIAIRE_TYPES_PAIEMENT_GROUPE)[number];

  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  factureMensuelleIds!: string[];
}

export class CreerCompteFinancierDto {
  @IsIn(TYPES_COMPTE_FINANCIER)
  type!: (typeof TYPES_COMPTE_FINANCIER)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nom!: string;

  @IsOptional() @IsString() @MaxLength(200) banqueNom?: string;
  @IsOptional() @IsString() @MaxLength(50) numeroCompte?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fondsInitial!: number;
}

export class ApprovisionnerCompteDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  montant!: number;

  @IsIn(SOURCES_APPROVISIONNEMENT)
  source!: (typeof SOURCES_APPROVISIONNEMENT)[number];

  /** Requis si `source === 'AUTRE_COMPTE'` — vérifié côté service. */
  @IsOptional() @IsUUID() compteSourceId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  piecesJustificatives?: string[];
}

/**
 * Paiement RÉEL d'une facture mensuelle individuelle OU d'un paiement groupé
 * — exactement l'un des deux (`factureMensuelleId` XOR `paiementGroupeId`),
 * vérifié dans le service (pas modélisable en `class-validator` seul).
 */
export class PayerFactureDto {
  @IsOptional() @IsUUID() factureMensuelleId?: string;
  @IsOptional() @IsUUID() paiementGroupeId?: string;

  @IsUUID() compteId!: string;

  /** Omis : paie le solde restant dû (facture) / le montant total (groupe). */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) montant?: number;

  /** Fournie ET dans le futur : programme le paiement SANS débiter — un
   * nouvel appel sans cette date confirme et exécute le débit réel. */
  @IsOptional() @IsDateString() dateProgrammee?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  preuvePaiement?: string[];
}

/** Libellé seulement : le solde d'un compte n'est jamais modifiable directement. */
export class ModifierCompteFinancierDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nom!: string;
}
