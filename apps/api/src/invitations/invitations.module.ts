import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { SupabaseAdminService } from './supabase-admin.service';

/**
 * Module `invitations/` — un domaine métier strict (v18 §4) : provisioning des
 * comptes par invitation sécurisée (v5 §3, PROMPT 6). Aucun mot de passe généré
 * ou visible côté serveur.
 */
@Module({
  imports: [IdentityModule],
  controllers: [InvitationsController],
  providers: [InvitationsService, SupabaseAdminService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
