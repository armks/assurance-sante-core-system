import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { RecusController } from './recus.controller';
import { RecusService } from './recus.service';

@Module({ imports: [IdentityModule], controllers: [RecusController], providers: [RecusService] })
export class RecusModule {}
