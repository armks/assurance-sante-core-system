import { Module } from '@nestjs/common';
import { DependancesModule } from '../dependances/dependances.module';
import { IdentityModule } from '../identity/identity.module';
import { SupabaseAdminService } from '../invitations/supabase-admin.service';
import { ComptesController } from './comptes.controller';
import { ComptesService } from './comptes.service';

/**
 * Module `comptes/` — cycle de vie des comptes utilisateurs (révoquer, réactiver, changer le
 * rôle, supprimer, réactiver un périmètre désarchivé). Séparé d'`identity/` pour éviter la
 * dépendance circulaire avec `dependances/` (qui lit l'identité).
 */
@Module({
  imports: [IdentityModule, DependancesModule],
  controllers: [ComptesController],
  providers: [ComptesService, SupabaseAdminService],
  exports: [ComptesService],
})
export class ComptesModule {}
