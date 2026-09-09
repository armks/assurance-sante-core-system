import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { ProvisioningService } from './provisioning.service';

/**
 * Module `identity/` — un domaine métier strict (v18 §4).
 * Périmètre : lecture de l'identité et des permissions de l'utilisateur connecté
 * (IdentityService) et règles de provisioning — quels sous-rôles il peut créer
 * (ProvisioningService, PROMPT 5).
 */
@Module({
  controllers: [IdentityController],
  providers: [IdentityService, ProvisioningService],
  exports: [IdentityService, ProvisioningService],
})
export class IdentityModule {}
