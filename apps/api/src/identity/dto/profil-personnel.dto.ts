import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Pseudo d'affichage : 2 à 30 caractères (contrôlé par le service) ; vide ou absent = le retirer. */
export class ModifierMonProfilDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(60)
  pseudo?: string;
}
