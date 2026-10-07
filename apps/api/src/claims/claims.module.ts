import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ReferenceModule } from '../reference/reference.module';
import { AdjudicationClientService } from './adjudication-client.service';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

/**
 * Module `claims/` — un domaine métier strict (v18 §4) : réception des
 * réclamations, verrouillage, puis **appel du microservice Java d'adjudication**
 * (`adjudication-service`) et application de la décision (v1 §16, PROMPT 24).
 */
@Module({
  imports: [IdentityModule, ReferenceModule],
  controllers: [ClaimsController],
  providers: [ClaimsService, AdjudicationClientService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
