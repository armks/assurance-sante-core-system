import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { GeocodageService } from './geocodage.service';
import { ProviderController } from './provider.controller';
import { ProviderService } from './provider.service';
import { DependancesModule } from '../dependances/dependances.module';

/**
 * Module `provider/` — un domaine métier strict (v18 §4) : réseau de soins
 * (établissements de santé + pharmacies) avec recherche géolocalisée
 * (v9 phase 4.1, PROMPT 14) et automatisation (géocodage Nominatim, vérification
 * périodique, détection de doublons — v8 §9, PROMPT 15).
 */
@Module({
  imports: [IdentityModule, DependancesModule],
  controllers: [ProviderController],
  providers: [ProviderService, GeocodageService],
  exports: [ProviderService],
})
export class ProviderModule {}
