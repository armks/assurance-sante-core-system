import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { DependancesService } from './dependances.service';
import { ACTIONS, type Action } from './dependances.types';

/**
 * « Action possible ? » (ADR-007) — l'écran n'affiche un bouton que si l'action est
 * possible ; le serveur refuse lui-même (409) au moment de l'action.
 *
 * - `GET /dependances/:entite/:id` : verdicts des 4 actions ;
 * - `GET /dependances/:entite/:id/:action` : verdict d'une action
 *   (`supprimer` | `archiver` | `desarchiver` | `modifier`).
 */
@Controller('dependances')
@UseGuards(SupabaseAuthGuard)
export class DependancesController {
  constructor(private readonly dependances: DependancesService) {}

  @Get(':entite/:id')
  tout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entite') entite: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.dependances.verifierTout(user, entite, id);
  }

  @Get(':entite/:id/:action')
  une(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entite') entite: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
  ) {
    if (!(ACTIONS as readonly string[]).includes(action)) {
      throw new NotFoundException(`Action inconnue : ${action} (supprimer, archiver, desarchiver, modifier).`);
    }
    return this.dependances.verifier(user, entite, id, action as Action);
  }
}
