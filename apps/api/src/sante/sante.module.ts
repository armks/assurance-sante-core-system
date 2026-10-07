import { Module } from '@nestjs/common';
import { AdjudicationClientModule } from '../adjudication-client/adjudication-client.module';
import { SanteController } from './sante.controller';
import { SanteService } from './sante.service';

/**
 * Module `sante/` : supervision de la plateforme (API, base, microservice
 * d'adjudication). Utilisé par la sonde publique et la santé système superadmin.
 */
@Module({
  imports: [AdjudicationClientModule],
  controllers: [SanteController],
  providers: [SanteService],
  exports: [SanteService],
})
export class SanteModule {}
