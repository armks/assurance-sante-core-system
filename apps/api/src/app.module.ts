import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CareEpisodeModule } from './care-episode/care-episode.module';
import { EmailModule } from './email/email.module';
import { IdentityModule } from './identity/identity.module';
import { InvitationsModule } from './invitations/invitations.module';
import { PlanModule } from './plan/plan.module';
import { PolicyModule } from './policy/policy.module';
import { PreauthorizationModule } from './preauthorization/preauthorization.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProviderModule } from './provider/provider.module';
import { ReferenceModule } from './reference/reference.module';
import { SuperadminModule } from './superadmin/superadmin.module';
import { TenantModule } from './tenant/tenant.module';
import { UnderwritingModule } from './underwriting/underwriting.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    EmailModule,
    AuthModule,
    IdentityModule,
    InvitationsModule,
    TenantModule,
    PlanModule,
    PolicyModule,
    BillingModule,
    UnderwritingModule,
    ProviderModule,
    ReferenceModule,
    CareEpisodeModule,
    PreauthorizationModule,
    SuperadminModule,
  ],
})
export class AppModule {}
