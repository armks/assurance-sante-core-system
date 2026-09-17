import { ArrayNotEmpty, ArrayUnique, IsString, IsUUID, Matches } from 'class-validator';

export class ValiderCodeFacturationDto {
  /** Code de facturation, saisi par l'adhérent lui-même. */
  @IsString()
  @Matches(/^[A-Za-z0-9]{6,8}$/, {
    message: 'Le code doit contenir 6 à 8 caractères alphanumériques.',
  })
  code!: string;
}

export class GenererFactureSelectionDto {
  /** Actes du dossier cochés par le comptable pour ce cycle de facturation. */
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  acteIds!: string[];
}
