import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Périmètres dont les comptes sont désactivés à l'archivage (lot 3) et réactivés en groupe (lot 4). */
export const CIBLES_PERIMETRE = ['etablissement', 'pharmacie', 'societe'] as const;
export type CiblePerimetre = (typeof CIBLES_PERIMETRE)[number];

export class RevoquerCompteDto {
  @IsOptional() @IsString() @MaxLength(400) motif?: string;
}

export class ChangerRoleDto {
  @IsString() @IsNotEmpty() @MaxLength(80) role!: string;
}

export class ReactiverPerimetreDto {
  @IsIn(CIBLES_PERIMETRE) cible!: CiblePerimetre;
  @IsUUID() id!: string;
}

export class DesactivesPerimetreQuery {
  @IsIn(CIBLES_PERIMETRE) cible!: CiblePerimetre;
  @IsUUID() id!: string;
}
