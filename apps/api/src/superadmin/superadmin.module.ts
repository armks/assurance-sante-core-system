import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { InvitationsModule } from '../invitations/invitations.module';
import { ReferenceModule } from '../reference/reference.module';
import { SanteModule } from '../sante/sante.module';
import { CatalogueImportService } from './catalogue-import.service';
import { SuperadminActionsService } from './superadmin-actions.service';
import { SuperadminConfigController } from './superadmin-config.controller';
import { SuperadminConfigService } from './superadmin-config.service';
import { SuperadminController } from './superadmin.controller';

/**
 * Module `superadmin/` — administration SaaS (v14 §5, PROMPT 22) : licences des
 * organisations et confirmation à deux temps des actions sensibles
 * (création / suspension / prolongation), avec code envoyé par e-mail.
 */
@Module({
  imports: [IdentityModule, InvitationsModule, ReferenceModule, SanteModule],
  controllers: [SuperadminController, SuperadminConfigController],
  providers: [SuperadminActionsService, SuperadminConfigService, CatalogueImportService],
  exports: [SuperadminActionsService, SuperadminConfigService, CatalogueImportService],
})
export class SuperadminModule {}
