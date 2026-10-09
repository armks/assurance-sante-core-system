import { Module } from '@nestjs/common';
import { DependancesModule } from '../dependances/dependances.module';
import { IdentityModule } from '../identity/identity.module';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

/**
 * Module `payment/` — un domaine métier strict : regroupement de factures
 * mensuelles (établissement/pharmacie) en paiements programmés, et vue
 * d'ensemble globale ASSUREUR_COMPTABLE. Lit/écrit les tables `factures_
 * mensuelles_etablissement`/`factures_mensuelles_pharmacie` (modules
 * `preauthorization`/`pharmacy`) directement via Prisma — même convention
 * déjà en place ailleurs (`ContestationService` lit `pharmacy`/`preauthorization`).
 */
@Module({
  imports: [IdentityModule, DependancesModule],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
