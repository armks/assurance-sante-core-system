import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class OuvrirContestationDto {
  @IsUUID()
  ligneOrdonnanceId!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  motif!: string;
}

export class TrancherContestationDto {
  @IsIn(['VALIDEE', 'REJETEE'])
  decision!: 'VALIDEE' | 'REJETEE';
}
