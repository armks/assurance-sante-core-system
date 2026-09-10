import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { InvitationsModule } from '../invitations/invitations.module';
import { SuperadminActionsService } from './superadmin-actions.service';
import { SuperadminController } from './superadmin.controller';

/**
 * Module `superadmin/` — administration SaaS (v14 §5, PROMPT 22) : licences des
 * organisations et confirmation à deux temps des actions sensibles
 * (création / suspension / prolongation), avec code envoyé par e-mail.
 */
@Module({
  imports: [IdentityModule, InvitationsModule],
  controllers: [SuperadminController],
  providers: [SuperadminActionsService],
  exports: [SuperadminActionsService],
})
export class SuperadminModule {}
