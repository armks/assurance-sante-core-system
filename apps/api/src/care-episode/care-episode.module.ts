import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { Cim10Module } from '../cim10/cim10.module';
import { MemberModule } from '../member/member.module';
import { CareEpisodeController } from './care-episode.controller';
import { CareEpisodeService } from './care-episode.service';

/**
 * Module `care-episode/` — un domaine métier strict (v18 §4) : Dossier de Soins
 * et Numéro de Traitement, MoteurOuvertureDossier (v1 §15, PROMPT 17).
 */
@Module({
  imports: [IdentityModule, Cim10Module, MemberModule],
  controllers: [CareEpisodeController],
  providers: [CareEpisodeService],
  exports: [CareEpisodeService],
})
export class CareEpisodeModule {}
