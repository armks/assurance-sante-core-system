import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { DependancesController } from './dependances.controller';
import { DependancesService } from './dependances.service';

/**
 * Module `dependances/` — contrôle transverse des actions de suppression, archivage,
 * désarchivage et modification (ADR-007). Exporté vers les modules métier, qui
 * appellent `assertPossible` avant d'écrire.
 */
@Module({
  imports: [IdentityModule],
  controllers: [DependancesController],
  providers: [DependancesService],
  exports: [DependancesService],
})
export class DependancesModule {}
