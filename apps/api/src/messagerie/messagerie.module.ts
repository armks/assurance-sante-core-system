import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { MessagerieController } from './messagerie.controller';
import { MessagerieHub } from './messagerie.hub';
import { MessageriePurgeService } from './messagerie-purge.service';
import { MessagerieService } from './messagerie.service';
import { MessagerieStockage } from './messagerie-stockage';

@Module({
  imports: [IdentityModule],
  controllers: [MessagerieController],
  providers: [MessagerieService, MessagerieHub, MessagerieStockage, MessageriePurgeService],
})
export class MessagerieModule {}
