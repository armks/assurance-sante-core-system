import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { STATUTS_DOSSIER, TYPES_VISITE } from '../care-episode.types';

/** `GET care-episode/dossiers` — `statut` en liste blanche (une valeur inconnue
 * renvoie 400 au lieu d'une liste vide silencieuse). */
export class ListerDossiersQueryDto {
  @IsOptional()
  @IsIn(STATUTS_DOSSIER)
  statut?: (typeof STATUTS_DOSSIER)[number];

  @IsOptional()
  @IsUUID()
  etablissementId?: string;

  /** Période d'ouverture (AAAA-MM-JJ, bornes incluses) : limite le volume chargé côté serveur. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'du doit être une date AAAA-MM-JJ' })
  du?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'au doit être une date AAAA-MM-JJ' })
  au?: string;
}

export class OuvrirDossierDto {
  @IsOptional()
  @IsUUID()
  adherentId?: string;

  @IsOptional()
  @IsUUID()
  beneficiaireId?: string;

  @IsUUID()
  etablissementId!: string;

  @IsUUID()
  policeId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  motifConsultation!: string;

  @IsOptional() @IsString() @MaxLength(500) diagnosticEntree?: string;
  @IsOptional() @IsString() @MaxLength(20) codeCim10?: string;
}

export class AjouterConsultationDto {
  @IsUUID()
  medecinId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  motif!: string;

  @IsOptional() @IsString() @MaxLength(2000) observations?: string;
  @IsOptional() @IsString() @MaxLength(500) diagnostic?: string;
  @IsOptional() @IsString() @MaxLength(20) codeCim10?: string;
}

export class ClotureDto {
  @IsOptional() @IsString() @MaxLength(500) motif?: string;
  @IsOptional() @IsString() @MaxLength(20) codeCim10Sortie?: string;
}

export class ClotureForceeDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  motif!: string;
}

export class DefinirTypeVisiteDto {
  @IsIn(TYPES_VISITE)
  typeVisite!: (typeof TYPES_VISITE)[number];
}

export class AjouterNoteDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  contenu!: string;

  /** Note ciblée sur un acte précis — sinon, note générale sur le dossier. */
  @IsOptional()
  @IsUUID()
  acteDossierId?: string;
}
