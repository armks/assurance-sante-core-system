import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { Cim10Controller } from './cim10.controller';
import { Cim10Service } from './cim10.service';

/** Module `cim10/` — référentiel des maladies CIM-10 (prisma/sql/095), alimenté par le superadmin. */
@Module({
  imports: [IdentityModule],
  controllers: [Cim10Controller],
  providers: [Cim10Service],
  exports: [Cim10Service],
})
export class Cim10Module {}
