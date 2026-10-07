import { Module } from '@nestjs/common';
import { AdjudicationClientService } from './adjudication-client.service';

/**
 * Module `adjudication-client/` (v18 §4) : SEUL point d'appel du microservice
 * Java d'adjudication — adjudication d'une réclamation (`evaluer`) et calcul de
 * la part assurance sans écriture (`simuler`, ADR-005). Aucun calcul financier
 * dans le core NestJS : facture tiers payant, simulation à l'ajout d'un acte et
 * comptoir pharmacie passent tous par ce client.
 */
@Module({
  providers: [AdjudicationClientService],
  exports: [AdjudicationClientService],
})
export class AdjudicationClientModule {}
