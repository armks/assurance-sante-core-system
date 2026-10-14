import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Création d'une maladie du référentiel CIM-10 (ex. code « B50.9 », libellé « Paludisme à Plasmodium falciparum… »). */
export class CreerMaladieCim10Dto {
  @IsString() @IsNotEmpty() @MaxLength(10) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(300) libelle!: string;
}

export class ModifierMaladieCim10Dto {
  @IsString() @IsNotEmpty() @MaxLength(300) libelle!: string;
}
