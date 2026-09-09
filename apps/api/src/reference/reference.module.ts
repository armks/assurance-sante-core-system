import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ReferenceController } from './reference.controller';
import { ReferenceService } from './reference.service';

/**
 * Module `reference/` — un domaine métier strict (v18 §4) : référentiels
 * médicaux (actes + médicaments) et gouvernance d'homologation PROPOSE →
 * HOMOLOGUE → SUSPENDU/RETIRE (v8 §10, PROMPT 16).
 */
@Module({
  imports: [IdentityModule],
  controllers: [ReferenceController],
  providers: [ReferenceService],
  exports: [ReferenceService],
})
export class ReferenceModule {}
