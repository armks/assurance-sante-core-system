import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { EvenementsController } from './evenements.controller';
import { EvenementsService } from './evenements.service';
import { VitrineController } from './vitrine.controller';
import { StatistiquesService } from './statistiques.service';
import { VitrineService } from './vitrine.service';

/**
 * Module `vitrine/` — page d'accueil publique (formulaires Contact, Devenir
 * partenaire, Adhésion, newsletter, statistiques) et son contenu géré : les
 * événements du carrousel, administrés par ASSUREUR_INFORMATIQUE (seule partie
 * authentifiée, EvenementsController). EmailService vient du module
 * global `email/`, PrismaService du module global `prisma/`.
 */
@Module({
  imports: [IdentityModule],
  controllers: [VitrineController, EvenementsController],
  providers: [VitrineService, StatistiquesService, EvenementsService],
})
export class VitrineModule {}
