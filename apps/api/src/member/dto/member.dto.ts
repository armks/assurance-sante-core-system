import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  LIENS_PARENTE,
  MODES_PAIEMENT,
  SEXES,
  STATUTS_ADHERENT_FILTRE,
  STATUTS_MEMBRE,
  STATUTS_SORTANT_CIBLE,
} from '../member.types';

/** `GET member/adherents` — `statut` en liste blanche (une valeur inconnue
 * renvoie 400 au lieu d'une liste vide silencieuse). */
export class ListerAdherentsQueryDto {
  @IsOptional()
  @IsIn(STATUTS_ADHERENT_FILTRE)
  statut?: (typeof STATUTS_ADHERENT_FILTRE)[number];

  @IsOptional()
  @IsUUID()
  souscripteurId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateAdherentDto {
  @IsUUID()
  souscripteurId!: string;

  @IsOptional()
  @IsUUID()
  policeId?: string;

  @IsString() @IsNotEmpty() @MaxLength(120) nom!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) prenom!: string;

  @IsDateString()
  dateNaissance!: string;

  @IsIn(SEXES)
  sexe!: string;

  @IsOptional() @IsString() @MaxLength(64) ibanOuRib?: string;
  @IsOptional() @IsString() @MaxLength(120) banqueNom?: string;

  @IsOptional()
  @IsIn(MODES_PAIEMENT)
  modePaiementPrefere?: string;
}

export class UpdateAdherentDto {
  @IsOptional() @IsUUID() policeId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) nom?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) prenom?: string;
  @IsOptional() @IsDateString() dateNaissance?: string;
  @IsOptional() @IsIn(SEXES) sexe?: string;
  @IsOptional() @IsString() @MaxLength(64) ibanOuRib?: string;
  @IsOptional() @IsString() @MaxLength(120) banqueNom?: string;
  @IsOptional() @IsIn(MODES_PAIEMENT) modePaiementPrefere?: string;
}

export class CreateBeneficiaireDto {
  @IsIn(LIENS_PARENTE)
  lienParente!: string;

  @IsString() @IsNotEmpty() @MaxLength(120) nom!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) prenom!: string;

  @IsDateString()
  dateNaissance!: string;

  @IsIn(SEXES)
  sexe!: string;
}

export class UpdateBeneficiaireDto {
  @IsOptional() @IsIn(LIENS_PARENTE) lienParente?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) nom?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) prenom?: string;
  @IsOptional() @IsDateString() dateNaissance?: string;
  @IsOptional() @IsIn(SEXES) sexe?: string;
}

export class ChangerStatutDto {
  @IsIn(STATUTS_MEMBRE)
  statut!: string;

  @IsOptional() @IsString() @MaxLength(400) motif?: string;
}

/** Proposition d'ajout d'un adhérent PRINCIPAL par une société cliente —
 * validation structurelle seulement (format email/téléphone, doublons)
 * appliquée côté service, même règles que l'import Excel. */
export class ProposerAdherentDto {
  @IsString() @IsNotEmpty() @MaxLength(120) nom!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) prenom!: string;
  @IsString() @IsNotEmpty() @MaxLength(20) telephone!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) email!: string;
  @IsDateString() dateNaissance!: string;

  /** Mouvement de personnel à effet différé (prisma/sql/056) — mois auquel
   * CE LOT (le brouillon entier, pas seulement cette ligne) devient éligible
   * à la facturation. Omis = comportement historique inchangé (coupure
   * gouvernée séparément par `validerAdherent`). */
  @IsOptional() @IsDateString() moisEffet?: string;
}

/** Proposition d'ajout d'un bénéficiaire par une société cliente, rattaché à
 * un adhérent EXISTANT de sa propre société. */
export class ProposerBeneficiaireDto {
  @IsUUID() adherentId!: string;
  @IsIn(LIENS_PARENTE) lienParente!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) nom!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) prenom!: string;
  @IsDateString() dateNaissance!: string;
  @IsIn(SEXES) sexe!: string;
}

// --- Mouvements de personnel — SORTANTS (prisma/sql/056) ------------------

class SortantDto {
  @IsUUID() adherentId!: string;
  @IsIn(STATUTS_SORTANT_CIBLE) statutCible!: string;
  @IsString() @IsNotEmpty() @MaxLength(400) motif!: string;
}

export class ProposerSortantsDto {
  @IsUUID() souscripteurId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SortantDto)
  sortants!: SortantDto[];
}

export class ValiderSortantsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  adherentIds!: string[];
}
