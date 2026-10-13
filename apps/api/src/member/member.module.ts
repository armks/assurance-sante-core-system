import { Module } from '@nestjs/common';
import { AdjudicationClientModule } from '../adjudication-client/adjudication-client.module';
import { IdentityModule } from '../identity/identity.module';
import { AdherentService } from './adherent.service';
import { MemberCarteService } from './carte.service';
import { ImportAdherentsService } from './import-adherents.service';
import { MemberController } from './member.controller';
import { PlafondsService } from './plafonds.service';
import { PropositionsMembresController } from './propositions-membres.controller';
import { PropositionsMembresService } from './propositions-membres.service';
import { DependancesModule } from '../dependances/dependances.module';

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
  imports: [IdentityModule, DependancesModule, AdjudicationClientModule],
  controllers: [MemberController, PropositionsMembresController],
  providers: [AdherentService, MemberCarteService, ImportAdherentsService, PlafondsService, PropositionsMembresService],
  exports: [AdherentService],
})
export class MemberModule {}
