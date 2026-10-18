import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

export const STATUTS_FACTURE_MENSUELLE_TOUS = [
  'EN_PREPARATION',
  'SOUMISE',
  'VERIFIEE_MEDECIN_CONSEIL',
  'VALIDEE_PHARMACIEN_CONSEIL',
  'PROGRAMMEE_PAIEMENT',
  'PAIEMENT_PROGRAMME',
  'PARTIELLEMENT_REGLEE',
  'PAYEE',
] as const;

/** Critères du rapport de facturation mensuelle (établissements et pharmacies), tous facultatifs et cumulables. */
export class RapportFacturationQueryDto {
  /** Période de facturation (mois), bornes incluses : toute date du mois convient. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'du doit être une date AAAA-MM-JJ' })
  du?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'au doit être une date AAAA-MM-JJ' })
  au?: string;

  @IsOptional()
  @IsIn(['ETABLISSEMENT', 'PHARMACIE'])
  type?: 'ETABLISSEMENT' | 'PHARMACIE';

  /** Établissement ou pharmacie concerné. */
  @IsOptional()
  @IsUUID()
  prestataireId?: string;

  @IsOptional()
  @IsIn(STATUTS_FACTURE_MENSUELLE_TOUS)
  statut?: (typeof STATUTS_FACTURE_MENSUELLE_TOUS)[number];
}

export class ExportFacturationQueryDto extends RapportFacturationQueryDto {
  @IsIn(['pdf', 'docx'])
  format!: 'pdf' | 'docx';
}
