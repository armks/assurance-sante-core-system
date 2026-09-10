import { Module } from '@nestjs/common';
import { CareEpisodeModule } from '../care-episode/care-episode.module';
import { IdentityModule } from '../identity/identity.module';
import { PreauthorizationController } from './preauthorization.controller';
import { PreauthorizationService } from './preauthorization.service';

/**
 * Module `preauthorization/` — un domaine métier strict (v18 §4) : Code de
 * Consultation (v8 §2, PROMPT 18). Sa validation est la seule voie d'ouverture
 * d'un dossier de soins — d'où la dépendance à `CareEpisodeModule`.
 */
@Module({
  imports: [IdentityModule, CareEpisodeModule],
  controllers: [PreauthorizationController],
  providers: [PreauthorizationService],
  exports: [PreauthorizationService],
})
export class PreauthorizationModule {}
