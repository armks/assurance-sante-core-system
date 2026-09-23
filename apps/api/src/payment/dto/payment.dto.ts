import { ArrayMinSize, ArrayUnique, IsIn, IsUUID } from 'class-validator';
import { BENEFICIAIRE_TYPES_PAIEMENT_GROUPE } from '../payment.types';

export class AssocierFacturesPourPaiementDto {
  @IsIn(BENEFICIAIRE_TYPES_PAIEMENT_GROUPE)
  beneficiaireType!: (typeof BENEFICIAIRE_TYPES_PAIEMENT_GROUPE)[number];

  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  factureMensuelleIds!: string[];
}
