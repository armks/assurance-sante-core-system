import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';

/**
 * Module `policy/` — un domaine métier strict (v18 §4) : cycle de vie des
 * polices (machine à états) et des avenants.
 */
@Module({
  imports: [IdentityModule],
  controllers: [PolicyController],
  providers: [PolicyService],
  exports: [PolicyService],
})
export class PolicyModule {}
