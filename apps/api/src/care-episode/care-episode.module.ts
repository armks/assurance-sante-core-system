import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { CareEpisodeController } from './care-episode.controller';
import { CareEpisodeService } from './care-episode.service';

/**
 * Module `care-episode/` — un domaine métier strict (v18 §4) : Dossier de Soins
 * et Numéro de Traitement, MoteurOuvertureDossier (v1 §15, PROMPT 17).
 */
@Module({
  imports: [IdentityModule],
  controllers: [CareEpisodeController],
  providers: [CareEpisodeService],
  exports: [CareEpisodeService],
})
export class CareEpisodeModule {}
