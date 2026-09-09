import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { IdentityModule } from './identity/identity.module';
import { PlanModule } from './plan/plan.module';
import { PolicyModule } from './policy/policy.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './tenant/tenant.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    IdentityModule,
    TenantModule,
    PlanModule,
    PolicyModule,
    BillingModule,
  ],
})
export class AppModule {}
