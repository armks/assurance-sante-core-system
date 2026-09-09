import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { IdentityModule } from './identity/identity.module';
import { InvitationsModule } from './invitations/invitations.module';
import { PlanModule } from './plan/plan.module';
import { PolicyModule } from './policy/policy.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProviderModule } from './provider/provider.module';
import { TenantModule } from './tenant/tenant.module';
import { UnderwritingModule } from './underwriting/underwriting.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    IdentityModule,
    InvitationsModule,
    TenantModule,
    PlanModule,
    PolicyModule,
    BillingModule,
    UnderwritingModule,
    ProviderModule,
  ],
})
export class AppModule {}
