import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { FORMAT_DATE, FORMAT_HEURE } from './agenda';

const nettoyer = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Règle de l'agenda de présence d'un médecin : date précise, jour de la semaine récurrent ou absence. */
export class RegleAgendaDto {
  /** Médecin concerné (obligatoire pour l'accueil ; un médecin ne règle que son propre agenda). */
  @IsOptional()
  @IsUUID()
  medecinId?: string;

  @IsIn(['DATE', 'JOUR', 'ABSENCE'])
  type!: 'DATE' | 'JOUR' | 'ABSENCE';

  @IsOptional()
  @Matches(FORMAT_DATE, { message: 'date : format AAAA-MM-JJ attendu.' })
  date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  jourSemaine?: number;

  @IsOptional()
  @Matches(FORMAT_DATE, { message: 'valideDu : format AAAA-MM-JJ attendu.' })
  valideDu?: string;

  @IsOptional()
  @Matches(FORMAT_DATE, { message: 'valideAu : format AAAA-MM-JJ attendu.' })
  valideAu?: string;

  @Matches(FORMAT_HEURE, { message: 'heureDebut : format HH:MM attendu.' })
  heureDebut!: string;

  @Matches(FORMAT_HEURE, { message: 'heureFin : format HH:MM attendu.' })
  heureFin!: string;

  /** Intervalle entre deux rendez-vous (minutes) — inutile pour une absence. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(240)
  dureeCreneauMin?: number;
}

export class AgendaQueryDto {
  @IsOptional()
  @IsUUID()
  medecinId?: string;
}

export class CreneauxQueryDto {
  @IsUUID()
  medecinId!: string;

  @Matches(FORMAT_DATE, { message: 'du : format AAAA-MM-JJ attendu.' })
  du!: string;

  @Matches(FORMAT_DATE, { message: 'au : format AAAA-MM-JJ attendu.' })
  au!: string;

  /** Rendez-vous à ignorer (modification : son propre créneau reste disponible). */
  @IsOptional()
  @IsUUID()
  sauf?: string;
}

export class RechercheQueryDto {
  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @MaxLength(60)
  q?: string;
}

export class MedecinsQueryDto {
  @IsOptional()
  @IsUUID()
  etablissementId?: string;
}

export class ProposerRendezVousDto {
  @IsUUID()
  etablissementId!: string;

  @IsUUID()
  medecinId!: string;

  @IsUUID()
  adherentId!: string;

  @IsOptional()
  @IsUUID()
  beneficiaireId?: string;

  /** Début du créneau choisi (ISO 8601, doit être un créneau libre de l'agenda du médecin). */
  @IsISO8601()
  debut!: string;

  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @MaxLength(300)
  motif?: string;
}

export class ModifierRendezVousDto {
  @IsISO8601()
  debut!: string;

  /** Autre médecin du même établissement (accueil uniquement). */
  @IsOptional()
  @IsUUID()
  medecinId?: string;
}

export class MotifRendezVousDto {
  @Transform(nettoyer)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  motif!: string;
}

export class ListeRendezVousQueryDto {
  @IsOptional()
  @IsIn(['PROPOSE', 'CONFIRME', 'REFUSE', 'ANNULE'])
  statut?: string;
}
