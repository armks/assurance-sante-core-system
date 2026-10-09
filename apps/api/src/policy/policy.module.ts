import { Module } from '@nestjs/common';
import { DependancesModule } from '../dependances/dependances.module';
import { IdentityModule } from '../identity/identity.module';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';

/**
 * Module `policy/` — un domaine métier strict (v18 §4) : cycle de vie des
 * polices (machine à états) et des avenants.
 */
@Module({
  imports: [IdentityModule, DependancesModule],
  controllers: [PolicyController],
  providers: [PolicyService],
  exports: [PolicyService],
})
export class PolicyModule {}
