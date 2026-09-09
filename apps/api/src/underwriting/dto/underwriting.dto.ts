import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DECISIONS_QUESTIONNAIRE, DecisionQuestionnaire } from '../underwriting.types';

export class SoumettreQuestionnaireDto {
  @IsUUID()
  souscripteurId!: string;

  @IsObject()
  reponses!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  antecedentsDeclares?: string[];
}

export class EvaluerQuestionnaireDto {
  @IsIn(DECISIONS_QUESTIONNAIRE)
  decision!: DecisionQuestionnaire;

  /** Requis pour ACCEPTE_AVEC_EXCLUSION. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  exclusionsSpecifiques?: string[];

  /** Requis (> 0) pour ACCEPTE_SURPRIME. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(500)
  surprimePourcent?: number;
}

export class CalculerPrimeDto {
  @IsUUID()
  policeId!: string;

  @IsUUID()
  questionnaireMedicalId!: string;

  @IsInt()
  @Min(0)
  @Max(150)
  ageASubscription!: number;
}
