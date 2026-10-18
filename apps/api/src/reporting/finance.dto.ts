import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Critères du rapport de cotisations (appels de cotisation des sociétés et des adhérents individuels). */
export class RapportCotisationsQueryDto {
  /** Période de cotisation (mois), bornes incluses. */
  @IsOptional()
  @Matches(DATE, { message: 'du doit être une date AAAA-MM-JJ' })
  du?: string;

  @IsOptional()
  @Matches(DATE, { message: 'au doit être une date AAAA-MM-JJ' })
  au?: string;

  @IsOptional()
  @IsIn(['A_PAYER', 'PAYEE', 'EN_RETARD', 'ANNULEE'])
  statut?: 'A_PAYER' | 'PAYEE' | 'EN_RETARD' | 'ANNULEE';

  /** Société cliente (souscripteur). */
  @IsOptional()
  @IsUUID()
  souscripteurId?: string;
}

export class ExportCotisationsQueryDto extends RapportCotisationsQueryDto {
  @IsIn(['pdf', 'docx'])
  format!: 'pdf' | 'docx';
}

/** Critères du rapport financier (comptes et mouvements de la comptabilité de l'assureur). */
export class RapportFinancesQueryDto {
  /** Date des mouvements, bornes incluses. */
  @IsOptional()
  @Matches(DATE, { message: 'du doit être une date AAAA-MM-JJ' })
  du?: string;

  @IsOptional()
  @Matches(DATE, { message: 'au doit être une date AAAA-MM-JJ' })
  au?: string;

  @IsOptional()
  @IsIn(['APPROVISIONNEMENT', 'DEPENSE', 'TRANSFERT', 'PAIEMENT_FACTURE'])
  type?: 'APPROVISIONNEMENT' | 'DEPENSE' | 'TRANSFERT' | 'PAIEMENT_FACTURE';

  /** Compte financier (source ou destination du mouvement). */
  @IsOptional()
  @IsUUID()
  compteId?: string;
}

export class ExportFinancesQueryDto extends RapportFinancesQueryDto {
  @IsIn(['pdf', 'docx'])
  format!: 'pdf' | 'docx';
}
