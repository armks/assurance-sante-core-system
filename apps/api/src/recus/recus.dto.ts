import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TYPES_IMPRIMANTE, type TypeImprimante } from './recu-pdf';

const nettoyer = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

/** Paramétrage de l'impression de l'établissement ou de la pharmacie de l'utilisateur. */
export class ParametresImpressionDto {
  @IsIn(TYPES_IMPRIMANTE as unknown as string[])
  typeImprimante!: TypeImprimante;

  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @MaxLength(300)
  enTete?: string | null;

  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @MaxLength(300)
  piedPage?: string | null;

  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @MaxLength(60)
  identifiantFiscal?: string | null;

  @IsBoolean()
  afficherDetail!: boolean;
}

/** Imprimante à utiliser pour CE tirage (par défaut : celle du paramétrage). */
export class RecuQueryDto {
  @IsOptional()
  @IsIn(TYPES_IMPRIMANTE as unknown as string[])
  imprimante?: TypeImprimante;
}
