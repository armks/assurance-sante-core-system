import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseAuthGuard } from './supabase-auth.guard';

/**
 * Module d'authentification. Expose SupabaseAuthGuard pour un usage explicite via
 * `@UseGuards(SupabaseAuthGuard)` sur les contrôleurs protégés.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [SupabaseAuthGuard],
  exports: [SupabaseAuthGuard],
})
export class AuthModule {}
