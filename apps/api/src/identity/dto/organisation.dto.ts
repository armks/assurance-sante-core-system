import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';

/** Nouveau chemin de page d'accueil (/{slug}) ; format vérifié par OrganisationsService. */
export class ModifierSlugDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @MaxLength(60)
  slug!: string;
}
