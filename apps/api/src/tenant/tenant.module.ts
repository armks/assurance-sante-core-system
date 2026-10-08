import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { DependancesModule } from '../dependances/dependances.module';

/**
 * Module `tenant/` — un domaine métier strict (v18 §4) : les souscripteurs
 * (sociétés affiliées et individuels) et leur comité de gestion.
 */
@Module({
  imports: [IdentityModule, DependancesModule],
  controllers: [TenantController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
