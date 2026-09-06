import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

/**
 * Module `identity/` — un domaine métier strict (v18 §4).
 * Périmètre actuel : lecture de l'identité et des permissions de l'utilisateur
 * connecté. Le provisioning de comptes (POST /identity/comptes, PROMPT 5) sera
 * ajouté ici ultérieurement.
 */
@Module({
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
