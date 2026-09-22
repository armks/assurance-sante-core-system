import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ContestationController } from './contestation.controller';
import { ContestationService } from './contestation.service';

/**
 * Module `contestation/` — un domaine métier strict : accès en revue du
 * pharmacien conseil sur les prescriptions, et mécanisme de contestation
 * d'une ligne d'ordonnance déjà servie (prévu depuis le plan directeur v9,
 * jamais construit jusqu'ici). Lit `lignes_ordonnance`/`ordonnances` (module
 * `pharmacy`/`preauthorization`) directement via Prisma — même convention
 * déjà en place ailleurs (`PreauthorizationService` lit `care-episode`).
 */
@Module({
  imports: [IdentityModule],
  controllers: [ContestationController],
  providers: [ContestationService],
  exports: [ContestationService],
})
export class ContestationModule {}
