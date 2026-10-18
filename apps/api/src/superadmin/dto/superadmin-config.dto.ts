import { PaginationQueryDto } from '../../common/pagination';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
  IsBoolean,
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_ELEMENTS_ACTION_MASSE } from '../superadmin.types';
import { STATUTS_HOMOLOGATION, USAGES_MEDICAMENT } from '../../reference/reference.types';

/** Définition / mise à jour d'un paramètre plateforme (valeur JSON arbitraire). */
export class DefinirParametreDto {
  @IsDefined()
  valeur!: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;
}

/** Acte du catalogue national — mêmes champs que ProposerActeDto + statut. */
export class CreerActeNationalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  libelle!: string;

  @IsOptional() @IsString() @MaxLength(120) categorie?: string;
  @IsOptional() @IsString() @MaxLength(40) versionNomenclature?: string;
  @IsOptional() @IsIn(STATUTS_HOMOLOGATION) statut?: string;

  // --- cotation (prisma/sql/080) : lettre-clé + coefficient, mode, catégorie de garantie, groupe ---
  @IsOptional() @IsString() @MaxLength(4) lettreCleCode?: string | null;
  @IsOptional() coefficient?: number | string | null;
  @IsOptional() @IsString() @MaxLength(10) modeCotation?: string | null;
  @IsOptional() @IsString() @MaxLength(60) categorieGarantie?: string | null;
  @IsOptional() @IsString() @MaxLength(40) groupeCode?: string | null;
}

/** Modification d'un acte du catalogue national : libellé, chapitre, version et cotation. */
export class ModifierActeNationalDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(300) libelle?: string;
  @IsOptional() @IsString() @MaxLength(120) categorie?: string | null;
  @IsOptional() @IsString() @MaxLength(40) versionNomenclature?: string | null;

  @IsOptional() @IsString() @MaxLength(4) lettreCleCode?: string | null;
  @IsOptional() coefficient?: number | string | null;
  @IsOptional() @IsString() @MaxLength(10) modeCotation?: string | null;
  @IsOptional() @IsString() @MaxLength(60) categorieGarantie?: string | null;
  @IsOptional() @IsString() @MaxLength(40) groupeCode?: string | null;
}

/** Création d'une lettre-clé (aucune valeur chiffrée). */
export class CreerLettreCleDto {
  @IsString() @IsNotEmpty() @MaxLength(4) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) libelle!: string;
  @IsOptional() ordre?: number;
}

export class ModifierLettreCleDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) libelle?: string;
  @IsOptional() ordre?: number;
}

/** Médicament du catalogue national — mêmes champs que ProposerMedicamentDto + statut. */
export class CreerMedicamentNationalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  denominationCommune!: string;

  @IsOptional() @IsString() @MaxLength(200) nomCommercial?: string;
  @IsOptional() @IsString() @MaxLength(20) codeEan?: string;
  @IsOptional() @IsString() @MaxLength(120) forme?: string;
  @IsOptional() @IsString() @MaxLength(80) dosage?: string;
  @IsOptional() @IsString() @MaxLength(120) conditionnement?: string;
  @IsOptional() @IsString() @MaxLength(200) classeTherapeutique?: string;
  @IsOptional() @IsBoolean() remboursable?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) tauxRemboursementStd?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) prixReferenceXof?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) prixMaxRemboursable?: number;
  @IsOptional() @IsBoolean() medicamentEssentiel?: boolean;
  @IsOptional() @IsBoolean() generiqueDisponible?: boolean;
  @IsOptional() @IsBoolean() ordonnanceObligatoire?: boolean;
  @IsOptional() @IsBoolean() medicamentControle?: boolean;
  @IsOptional() @IsIn(USAGES_MEDICAMENT) usage?: (typeof USAGES_MEDICAMENT)[number];
  @IsOptional() @IsIn(STATUTS_HOMOLOGATION) statut?: string;
}

/** Corps des actions de masse sur le catalogue national (ids distincts, plafond par requête). */
export class ActionMasseCatalogueDto {
  @IsArray({ message: 'ids doit être une liste d’identifiants.' })
  @ArrayMinSize(1, { message: 'Sélectionnez au moins un élément.' })
  @ArrayMaxSize(MAX_ELEMENTS_ACTION_MASSE, { message: `Au plus ${MAX_ELEMENTS_ACTION_MASSE} éléments par action.` })
  @ArrayUnique({ message: 'Un même élément ne peut figurer qu’une fois dans la sélection.' })
  @IsUUID('all', { each: true, message: 'Chaque identifiant doit être valide.' })
  ids!: string[];
}


/** Liste du catalogue national : statut, recherche texte et pagination serveur (facultatives ; sans `page`, liste complète). */
export class RechercheCatalogueQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  statut?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
