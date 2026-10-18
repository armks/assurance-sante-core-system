import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EmailModule } from '../email/email.module';
import { IdentityModule } from '../identity/identity.module';
import { LicenceInterceptor } from './licence.interceptor';
import { LicencesController, LicencesSuperadminController } from './licences.controller';
import { LicencesService } from './licences.service';

/**
 * Module `licences/` — activation et suivi des licences des sociétés d'assurance : types (essai, mensuelle, trimestrielle,
 * semestrielle, annuelle, 2 ans), code d'activation temporaire (24 h), activation directe et alerte d'expiration par le superadmin,
 * coupure d'accès quand la licence n'est plus active.
 */
@Module({
  imports: [IdentityModule, EmailModule],
  controllers: [LicencesController, LicencesSuperadminController],
  providers: [LicencesService, { provide: APP_INTERCEPTOR, useClass: LicenceInterceptor }],
  exports: [LicencesService],
})
export class LicencesModule {}
