import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { LONGUEUR_MAX_MESSAGE } from './messagerie-regles';

const nettoyer = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Premier message adressé à un utilisateur (= invitation à discuter). */
export class DemarrerConversationDto {
  @IsUUID()
  destinataireId!: string;

  @Transform(nettoyer)
  @IsString()
  @MinLength(1)
  @MaxLength(LONGUEUR_MAX_MESSAGE)
  contenu!: string;
}

export class EnvoyerMessageDto {
  @Transform(nettoyer)
  @IsString()
  @MinLength(1)
  @MaxLength(LONGUEUR_MAX_MESSAGE)
  contenu!: string;
}

/** Légende facultative d'un fichier joint (champ texte du formulaire multipart). */
export class EnvoyerFichierDto {
  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @MaxLength(LONGUEUR_MAX_MESSAGE)
  contenu?: string;
}

export class AnnuaireQueryDto {
  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @MaxLength(60)
  q?: string;
}

export class MessagesQueryDto {
  /** Horodatage ISO : ne renvoie que les messages antérieurs (pagination vers le passé). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  avant?: string;
}

export class IdConversationParams {
  @IsUUID()
  id!: string;
}
