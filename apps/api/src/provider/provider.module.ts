import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ProviderController } from './provider.controller';
import { ProviderService } from './provider.service';

/**
 * Module `provider/` — un domaine métier strict (v18 §4) : réseau de soins
 * (établissements de santé + pharmacies) avec recherche géolocalisée
 * (v9 phase 4.1, PROMPT 14).
 */
@Module({
  imports: [IdentityModule],
  controllers: [ProviderController],
  providers: [ProviderService],
  exports: [ProviderService],
})
export class ProviderModule {}
