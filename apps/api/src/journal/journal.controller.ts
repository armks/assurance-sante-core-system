import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { JournalService } from './journal.service';

/** Journal des actions : qui a créé / modifié / supprimé quoi (lecture seule — le journal est en ajout seul). */
@Controller('journal-actions')
@UseGuards(SupabaseAuthGuard)
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  @Get()
  lister(
    @CurrentUser() user: AuthenticatedUser,
    @Query('userId') userId?: string,
    @Query('table') table?: string,
    @Query('enregistrementId') enregistrementId?: string,
    @Query('operation') operation?: string,
    @Query('du') du?: string,
    @Query('au') au?: string,
    @Query('limite') limite?: string,
    @Query('decalage') decalage?: string,
  ) {
    const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
    const op = operation && ['CREATION', 'MODIFICATION', 'SUPPRESSION'].includes(operation) ? operation : undefined;
    return this.journal.lister(user, {
      userId: uuid(userId),
      table: table && /^[A-Za-z]{1,60}$/.test(table) ? table : undefined,
      enregistrementId: enregistrementId && enregistrementId.length <= 64 ? enregistrementId : undefined,
      operation: op,
      du: date(du),
      au: date(au),
      limite: limite ? Number(limite) || undefined : undefined,
      decalage: decalage ? Number(decalage) || undefined : undefined,
    });
  }
}
