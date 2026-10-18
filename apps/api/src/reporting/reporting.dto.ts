import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { STATUTS_DOSSIER } from '../care-episode/care-episode.types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Critères multicritères du rapport d'activité (tous facultatifs, cumulables). */
export class RapportActiviteQueryDto {
  /** Période d'ouverture des dossiers (bornes incluses). */
  @IsOptional()
  @Matches(DATE, { message: 'du doit être une date AAAA-MM-JJ' })
  du?: string;

  @IsOptional()
  @Matches(DATE, { message: 'au doit être une date AAAA-MM-JJ' })
  au?: string;

  @IsOptional()
  @IsUUID()
  etablissementId?: string;

  /** Société cliente (souscripteur de la police). */
  @IsOptional()
  @IsUUID()
  souscripteurId?: string;

  @IsOptional()
  @IsIn(STATUTS_DOSSIER)
  statut?: (typeof STATUTS_DOSSIER)[number];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Z_]+$/, { message: 'categorieActe invalide' })
  categorieActe?: string;

  @IsOptional()
  @IsIn(['NON_REQUISE', 'EN_ATTENTE_EXPLOITATION', 'EN_ATTENTE_MEDECIN_CONSEIL', 'APPROUVEE', 'APPROUVEE_PARTIELLEMENT', 'REFUSEE'])
  statutPreautorisation?: string;

  /** Médecin prescripteur des actes. */
  @IsOptional()
  @IsUUID()
  medecinId?: string;
}

export class ExportRapportQueryDto extends RapportActiviteQueryDto {
  @IsIn(['pdf', 'docx'])
  format!: 'pdf' | 'docx';
}
