import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { UnderwritingController } from './underwriting.controller';
import { UnderwritingService } from './underwriting.service';

/**
 * Module `underwriting/` — un domaine métier strict (v18 §4) : questionnaire
 * médical à la souscription individuelle et tarification au risque. Séparation
 * stricte médecin souscripteur / médecin conseil (v10 §3).
 */
@Module({
  imports: [IdentityModule],
  controllers: [UnderwritingController],
  providers: [UnderwritingService],
  exports: [UnderwritingService],
})
export class UnderwritingModule {}
