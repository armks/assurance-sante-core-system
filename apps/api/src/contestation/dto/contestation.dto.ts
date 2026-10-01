import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { RecherchePeriodeQueryDto } from '../../common/pagination';

export class OuvrirContestationDto {
  @IsUUID()
  ligneOrdonnanceId!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  motif!: string;
}

export class TrancherContestationDto {
  @IsIn(['VALIDEE', 'REJETEE'])
  decision!: 'VALIDEE' | 'REJETEE';
}

export class OuvrirContestationActeDto {
  @IsUUID()
  acteDossierId!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  motif!: string;
}

/**
 * « Actes / prescriptions à examiner » : pagination serveur + recherche
 * (patient, n° de traitement, établissement, acte ou médicament — sans accent)
 * + période de prescription + état de contestation. Remplace le `take: 200`
 * qui rendait les éléments anciens inaccessibles.
 */
export const ETATS_CONTESTATION_REVUE = ['SANS', 'EN_COURS', 'TRAITEE'] as const;

export class RevueQueryDto extends RecherchePeriodeQueryDto {
  @IsOptional()
  @IsIn(ETATS_CONTESTATION_REVUE)
  contestation?: (typeof ETATS_CONTESTATION_REVUE)[number];
}

export class RevueActesQueryDto extends RevueQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  categorie?: string;
}
