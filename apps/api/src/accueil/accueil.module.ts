import { Module } from '@nestjs/common';

import { CareEpisodeModule } from '../care-episode/care-episode.module';
import { IdentityModule } from '../identity/identity.module';
import { MemberModule } from '../member/member.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PreauthorizationModule } from '../preauthorization/preauthorization.module';
import { ReferenceModule } from '../reference/reference.module';
import { AccueilCarteService } from './accueil-carte.service';
import { AccueilController } from './accueil.controller';

/** Parcours d'accueil de l'établissement : fiche de la carte, type d'acte, émission du code de confirmation. */
@Module({
  imports: [IdentityModule, MemberModule, CareEpisodeModule, PreauthorizationModule, ReferenceModule, NotificationsModule],
  controllers: [AccueilController],
  providers: [AccueilCarteService],
})
export class AccueilModule {}
