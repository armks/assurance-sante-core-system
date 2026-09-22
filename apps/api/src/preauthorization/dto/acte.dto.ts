import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CATEGORIES_ACTE,
  DECISIONS_EXPLOITATION_PREAUTORISATION,
  TYPES_VISITE_FREQUENCE_CONSULTATION,
} from '../preauthorization.types';

export class AjouterActeDto {
  @IsIn(CATEGORIES_ACTE)
  categorieActe!: (typeof CATEGORIES_ACTE)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  libelle!: string;

  @IsOptional() @IsString() @MaxLength(40) codeActe?: string;

  @IsOptional() @IsUUID() consultationId?: string;
  @IsOptional() @IsUUID() medecinPrescripteurId?: string;

  @IsOptional() @IsInt() @Min(1) @Max(1000) quantite?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montantPrescrit?: number;

  @IsOptional() @IsString() dateRealisation?: string;
}

export class ValiderPreautorisationDto {
  @IsIn(['APPROUVE', 'REFUSE'])
  decision!: 'APPROUVE' | 'REFUSE';

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  motif!: string;
}

/**
 * Premier niveau (ASSUREUR_EXPLOITATION/_CONJOINTE). `quantiteApprouvee` /
 * `typeApprouve` / `ticketModerateurAjuste` ne s'appliquent qu'à une décision
 * `APPROUVE` (approbation partielle possible) — ignorés silencieusement pour
 * `REFUSE`/`ESCALADE_MEDECIN_CONSEIL`, jamais une erreur : un service qui
 * envoie ces champs par précaution ne doit pas voir sa décision rejetée.
 */
export class TraiterParExploitationDto {
  @IsIn(DECISIONS_EXPLOITATION_PREAUTORISATION)
  decision!: (typeof DECISIONS_EXPLOITATION_PREAUTORISATION)[number];

  @IsOptional() @IsInt() @Min(0) quantiteApprouvee?: number;

  @IsOptional() @IsString() @MaxLength(300) typeApprouve?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  ticketModerateurAjuste?: number;

  /**
   * Orientation vers un établissement EXÉCUTANT distinct de celui d'origine
   * du dossier — ne s'applique qu'à une décision `APPROUVE` (ignoré sinon,
   * même convention que `quantiteApprouvee`/`typeApprouve`).
   */
  @IsOptional() @IsUUID() etablissementExecutionId?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  motif!: string;
}

/**
 * Débloque, une seule fois, la règle anti-répétition (14 jours) pour un acte
 * ANALYSES_EXAMENS_MEDICAUX précis (même `codeActe`) sur un ticket de soins
 * précis — réservé exclusivement à ASSUREUR_MEDECIN_CONSEIL.
 */
export class AutoriserRepetitionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  codeActe!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  motif!: string;
}

/**
 * Débloque, une seule fois, la règle de fréquence des consultations
 * (14 jours) pour un TYPE de visite précis (généraliste ou spécialiste,
 * compteurs séparés) sur un ticket de soins précis — réservé exclusivement
 * à ASSUREUR_MEDECIN_CONSEIL.
 */
export class AutoriserRepetitionConsultationDto {
  @IsIn(TYPES_VISITE_FREQUENCE_CONSULTATION)
  typeVisite!: (typeof TYPES_VISITE_FREQUENCE_CONSULTATION)[number];

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  motif!: string;
}
