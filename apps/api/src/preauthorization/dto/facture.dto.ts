import { ArrayNotEmpty, ArrayUnique, IsIn, IsString, IsUUID, Matches } from 'class-validator';
import { DECISIONS_VERIFICATION_FACTURE_MENSUELLE_ETABLISSEMENT } from '../preauthorization.types';

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

export class SoumettreFactureMensuelleEtablissementDto {
  /** Premier jour du mois précédent — 'YYYY-MM-DD'. Toute autre date est refusée. */
  @Matches(/^\d{4}-\d{2}-01$/, {
    message: "periode doit être le premier jour d'un mois, au format YYYY-MM-01.",
  })
  periode!: string;
}

export class VerifierFactureMensuelleEtablissementDto {
  @IsIn(DECISIONS_VERIFICATION_FACTURE_MENSUELLE_ETABLISSEMENT)
  decision!: (typeof DECISIONS_VERIFICATION_FACTURE_MENSUELLE_ETABLISSEMENT)[number];
}
