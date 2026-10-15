import { PeriodeQueryDto } from '../../common/pagination';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class GenererCodeConsultationDto {
  @IsOptional()
  @IsUUID()
  adherentId?: string;

  @IsOptional()
  @IsUUID()
  beneficiaireId?: string;

  @IsUUID()
  etablissementId!: string;

  @IsUUID()
  policeId!: string;
}

export class ValiderCodeConsultationDto {
  /** Code saisi par l'établissement (6 à 8 caractères alphanumériques majuscules). */
  @IsString()
  @Matches(/^[A-Za-z0-9]{6,8}$/, {
    message: 'Le code doit contenir 6 à 8 caractères alphanumériques.',
  })
  code!: string;

  @IsUUID()
  etablissementId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  motifConsultation!: string;

  @IsOptional() @IsString() @MaxLength(500) diagnosticEntree?: string;
  @IsOptional() @IsString() @MaxLength(20) codeCim10?: string;
}

/**
 * Listes de l'ADHÉRENT (codes de consultation / d'ordonnance, factures) :
 * pagination serveur (remplace `take: 50` — l'historique au-delà était
 * inaccessible), statut et période (date d'émission / de création).
 */
export const STATUTS_CODE_CONSULTATION = ['EMIS', 'CONFIRME_PATIENT', 'UTILISE_ETABLISSEMENT', 'EXPIRE', 'ANNULE'] as const;
export const STATUTS_CODE_ORDONNANCE = ['EMIS', 'PRESENTE_PHARMACIE', 'UTILISE_PARTIEL', 'UTILISE_COMPLET', 'EXPIRE', 'ANNULE'] as const;
export const STATUTS_FACTURE_DOSSIER = ['EMISE', 'EN_VALIDATION', 'VALIDEE', 'REGLEE', 'CONTESTEE'] as const;

export class ListerMesCodesConsultationQueryDto extends PeriodeQueryDto {
  @IsOptional()
  @IsIn(STATUTS_CODE_CONSULTATION)
  statut?: (typeof STATUTS_CODE_CONSULTATION)[number];
}

export class ListerMesCodesOrdonnanceQueryDto extends PeriodeQueryDto {
  @IsOptional()
  @IsIn(STATUTS_CODE_ORDONNANCE)
  statut?: (typeof STATUTS_CODE_ORDONNANCE)[number];
}

export class ListerMesFacturesQueryDto extends PeriodeQueryDto {
  @IsOptional()
  @IsIn(STATUTS_FACTURE_DOSSIER)
  statut?: (typeof STATUTS_FACTURE_DOSSIER)[number];

  /** N° de carte du titulaire ou d'un bénéficiaire (contient, casse ignorée). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  carte?: string;
}
