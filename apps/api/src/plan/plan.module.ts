import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ReferenceModule } from '../reference/reference.module';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';

/**
 * Module `plan/` — un domaine métier strict (v18 §4) : configuration des
 * produits d'assurance versionnés et de leurs garanties.
 */
@Module({
  imports: [IdentityModule, ReferenceModule],
  controllers: [PlanController],
  providers: [PlanService],
  exports: [PlanService],
})
export class PlanModule {}
