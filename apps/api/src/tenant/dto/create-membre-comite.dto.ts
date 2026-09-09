import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** Ajout d'un membre au comité de gestion d'un souscripteur COLLECTIVITE. */
export class CreateMembreComiteDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fonction!: string; // Président, Trésorier, Secrétaire, ...

  @IsOptional()
  @IsString()
  dateDebutMandat?: string; // ISO date (YYYY-MM-DD)

  @IsOptional()
  @IsString()
  dateFinMandat?: string;
}
