import { Module } from '@nestjs/common';
import { VitrineController } from './vitrine.controller';
import { StatistiquesService } from './statistiques.service';
import { VitrineService } from './vitrine.service';

/**
 * Module `vitrine/` — page d'accueil publique (formulaires Contact, Devenir
 * partenaire, Adhésion, newsletter). Domaine strict et isolé : aucune donnée
 * d'organisation, aucune authentification. EmailService vient du module
 * global `email/`, PrismaService du module global `prisma/`.
 */
@Module({
  controllers: [VitrineController],
  providers: [VitrineService, StatistiquesService],
})
export class VitrineModule {}
