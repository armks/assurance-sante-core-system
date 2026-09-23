import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AdherentService } from './adherent.service';
import { MemberCarteService } from './carte.service';
import { ImportAdherentsService } from './import-adherents.service';
import { MemberController } from './member.controller';

/**
 * Module `member/` — un domaine métier strict (v18 §4) : fichier des membres,
 * adhérents (titulaires) et bénéficiaires (ayants droit). v9 phase 3, PROMPT 12.
 *
 * Comble la dette identifiée par l'audit de consolidation : `adherent_id` /
 * `beneficiaire_id` sont désormais de vraies clés étrangères (prisma/sql/022) et
 * le contrôle d'éligibilité au parcours de soins vérifie le statut réel de
 * l'adhérent (`CareEpisodeService`).
 */
@Module({
  imports: [IdentityModule],
  controllers: [MemberController],
  providers: [AdherentService, MemberCarteService, ImportAdherentsService],
  exports: [AdherentService],
})
export class MemberModule {}
