import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';

/** Module `reporting/` — rapports et statistiques à critères multiples, exports PDF et Word. */
@Module({
  imports: [IdentityModule],
  controllers: [ReportingController],
  providers: [ReportingService],
})
export class ReportingModule {}
