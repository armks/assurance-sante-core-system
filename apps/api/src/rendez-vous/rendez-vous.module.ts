import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { RendezVousController } from './rendez-vous.controller';
import { RendezVousService } from './rendez-vous.service';

@Module({ imports: [IdentityModule], controllers: [RendezVousController], providers: [RendezVousService] })
export class RendezVousModule {}
