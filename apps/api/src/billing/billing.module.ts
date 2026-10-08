import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { DependancesModule } from '../dependances/dependances.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

/**
 * Module `billing/` — un domaine métier strict (v18 §4) : tarification collective
 * (grilles), génération et suivi des cotisations.
 */
@Module({
  imports: [IdentityModule, DependancesModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
