import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AnnoncesController } from './annonces.controller';
import { AnnoncesService } from './annonces.service';
import { DemandesAdhesionController } from './demandes-adhesion.controller';
import { DemandesAdhesionService } from './demandes-adhesion.service';
import { EvenementsController } from './evenements.controller';
import { EvenementsService } from './evenements.service';
import { PartenairesVitrineController } from './partenaires-vitrine.controller';
import { PartenairesVitrineService } from './partenaires-vitrine.service';
import { VitrineController } from './vitrine.controller';
import { StatistiquesService } from './statistiques.service';
import { VitrineService } from './vitrine.service';
import { DependancesModule } from '../dependances/dependances.module';

/**
 * Module `vitrine/` — page d'accueil publique (formulaires Contact, Devenir
 * partenaire, Adhésion, newsletter, statistiques) et son contenu géré : les
 * événements du carrousel, administrés par ASSUREUR_INFORMATIQUE (seule partie
 * authentifiée, EvenementsController). EmailService vient du module
 * global `email/`, PrismaService du module global `prisma/`.
 */
@Module({
  imports: [IdentityModule, DependancesModule],
  controllers: [VitrineController, AnnoncesController, EvenementsController, PartenairesVitrineController, DemandesAdhesionController],
  providers: [VitrineService, StatistiquesService, AnnoncesService, EvenementsService, PartenairesVitrineService, DemandesAdhesionService],
})
export class VitrineModule {}
