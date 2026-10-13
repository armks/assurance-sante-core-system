import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';

@Module({
  imports: [IdentityModule],
  controllers: [JournalController],
  providers: [JournalService],
})
export class JournalModule {}
