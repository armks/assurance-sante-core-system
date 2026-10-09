import { Module } from '@nestjs/common';
import { DependancesModule } from '../dependances/dependances.module';
import { IdentityModule } from '../identity/identity.module';
import { ReferenceModule } from '../reference/reference.module';
import { ConventionsController } from './conventions.controller';
import { ConventionsService } from './conventions.service';

/** Module `conventions/` — conventions établissement × assureur : circuit de validation, valeurs par lettre-clé, exceptions par acte. */
@Module({
  imports: [IdentityModule, DependancesModule, ReferenceModule],
  controllers: [ConventionsController],
  providers: [ConventionsService],
  exports: [ConventionsService],
})
export class ConventionsModule {}
