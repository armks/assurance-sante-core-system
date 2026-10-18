import { LicencesModule } from './licences/licences.module';
import { ReportingModule } from './reporting/reporting.module';
import { RecusModule } from './recus/recus.module';
import { MessagerieModule } from './messagerie/messagerie.module';
import { RendezVousModule } from './rendez-vous/rendez-vous.module';
import { Cim10Module } from './cim10/cim10.module';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LimiteurDebitGuard } from './common/limiteur-debit.guard';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActeurInterceptor } from './common/acteur.interceptor';
import { JournalModule } from './journal/journal.module';
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
import { AccueilModule } from './accueil/accueil.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProviderModule } from './provider/provider.module';
import { ConventionsModule } from './conventions/conventions.module';
import { TarifsProposesModule } from './tarifs-proposes/tarifs-proposes.module';
import { ReferenceModule } from './reference/reference.module';
import { SanteModule } from './sante/sante.module';
import { DependancesModule } from './dependances/dependances.module';
import { VitrineModule } from './vitrine/vitrine.module';
import { SuperadminModule } from './superadmin/superadmin.module';
import { TenantModule } from './tenant/tenant.module';
import { UnderwritingModule } from './underwriting/underwriting.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 600 }]),
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
    TarifsProposesModule,
    CareEpisodeModule,
    ReportingModule,
    RecusModule,
    MessagerieModule,
    RendezVousModule,
    LicencesModule,
    PreauthorizationModule,
    AccueilModule,
    PharmacyModule,
    ClaimsModule,
    ContestationModule,
    PaymentModule,
    SuperadminModule,
    VitrineModule,
    SanteModule,
    DependancesModule,
    JournalModule,
    Cim10Module,
  ],
  // Identité de l'utilisateur propagée à toute écriture de la requête (journal des actions)
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ActeurInterceptor },
    // limite de débit globale (anti force brute / déni de service) ; plafonds plus bas sur les routes de codes (@Throttle)
    { provide: APP_GUARD, useClass: LimiteurDebitGuard },
  ],
})
export class AppModule {}
