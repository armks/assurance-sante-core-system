import { Module } from '@nestjs/common';
import { AdjudicationClientModule } from '../adjudication-client/adjudication-client.module';
import { ConventionsModule } from '../conventions/conventions.module';
import { DependancesModule } from '../dependances/dependances.module';
import { IdentityModule } from '../identity/identity.module';
import { TarifsProposesController } from './tarifs-proposes.controller';
import { TarifsProposesService } from './tarifs-proposes.service';

/** Module `tarifs-proposes/` — montant proposé par l'établissement pour un acte non tarifable (ADR-008, lot 4). */
@Module({
  imports: [IdentityModule, DependancesModule, AdjudicationClientModule, ConventionsModule],
  controllers: [TarifsProposesController],
  providers: [TarifsProposesService],
  exports: [TarifsProposesService],
})
export class TarifsProposesModule {}
