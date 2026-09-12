import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';

/**
 * Module `pharmacy/` — un domaine métier strict : révision majeure du flux
 * de dispensation pharmacie (verrou par ligne de médicament, pas par
 * ordonnance entière). Coexiste avec `preauthorization/` (codes-ordonnance,
 * PROMPT 19), qui reste inchangé.
 */
@Module({
  imports: [IdentityModule],
  controllers: [PharmacyController],
  providers: [PharmacyService],
  exports: [PharmacyService],
})
export class PharmacyModule {}
