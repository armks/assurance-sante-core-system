import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateGarantieDto } from './garantie.dto';

export class CreateProduitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  nom!: string;

  /** Garanties initiales (optionnel — on peut aussi les ajouter ensuite). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGarantieDto)
  garanties?: CreateGarantieDto[];
}

/** Le produit ne peut être modifié qu'en statut BROUILLON, et seul le nom l'est. */
export class UpdateProduitDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  nom?: string;
}
