import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { OrganisationsService } from './organisations.service';
import { ProfilPersonnelService } from './profil-personnel.service';
import { ProvisioningService } from './provisioning.service';

/**
 * Module `identity/` — un domaine métier strict (v18 §4).
 * Périmètre : lecture de l'identité et des permissions de l'utilisateur connecté
 * (IdentityService), règles de provisioning — quels sous-rôles il peut créer
 * (ProvisioningService, PROMPT 5) — et onboarding des organisations par le
 * superadministrateur (OrganisationsService, PROMPT 6).
 */
@Module({
  controllers: [IdentityController],
  providers: [IdentityService, ProvisioningService, OrganisationsService, ProfilPersonnelService],
  exports: [IdentityService, ProvisioningService],
})
export class IdentityModule {}
