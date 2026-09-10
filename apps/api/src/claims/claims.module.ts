import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

/**
 * Module `claims/` — un domaine métier strict (v18 §4) : réception des
 * réclamations et verrouillage pour adjudication (v1 §16, PROMPT 24).
 * L'appel au microservice Java d'adjudication est ajouté au prompt suivant.
 */
@Module({
  imports: [IdentityModule],
  controllers: [ClaimsController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
