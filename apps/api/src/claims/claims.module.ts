import { Module } from '@nestjs/common';
import { AdjudicationClientModule } from '../adjudication-client/adjudication-client.module';
import { IdentityModule } from '../identity/identity.module';
import { ReferenceModule } from '../reference/reference.module';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

/**
 * Module `claims/` — un domaine métier strict (v18 §4) : réception des
 * réclamations, verrouillage, puis **appel du microservice Java d'adjudication**
 * (`adjudication-service`, via `AdjudicationClientModule`) et application de la
 * décision (v1 §16, PROMPT 24).
 */
@Module({
  imports: [IdentityModule, ReferenceModule, AdjudicationClientModule],
  controllers: [ClaimsController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
