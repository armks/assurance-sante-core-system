import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CareEpisodeModule } from './care-episode/care-episode.module';
import { ClaimsModule } from './claims/claims.module';
import { ComptesModule } from './comptes/comptes.module';
import { ContestationModule } from './contestation/contestation.module';
import { EmailModule } from './email/email.module';
import { IdentityModule } from './identity/identity.module';
import { InvitationsModule } from './invitations/invitations.module';
import { MemberModule } from './member/member.module';
import { PharmacyModule } from './pharmacy/pharmacy.module';
import { PaymentModule } from './payment/payment.module';
import { PlanModule } from './plan/plan.module';
import { PolicyModule } from './policy/policy.module';
import { PreauthorizationModule } from './preauthorization/preauthorization.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProviderModule } from './provider/provider.module';
import { ConventionsModule } from './conventions/conventions.module';
import { ReferenceModule } from './reference/reference.module';
import { SanteModule } from './sante/sante.module';
import { DependancesModule } from './dependances/dependances.module';
import { VitrineModule } from './vitrine/vitrine.module';
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
    ComptesModule,
    TenantModule,
    MemberModule,
    PlanModule,
    PolicyModule,
    BillingModule,
    UnderwritingModule,
    ProviderModule,
    ReferenceModule,
    ConventionsModule,
    CareEpisodeModule,
    PreauthorizationModule,
    PharmacyModule,
    ClaimsModule,
    ContestationModule,
    PaymentModule,
    SuperadminModule,
    VitrineModule,
    SanteModule,
    DependancesModule,
  ],
})
export class AppModule {}
