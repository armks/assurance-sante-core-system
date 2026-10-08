import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { DependancesService } from './dependances.service';
import { ACTIONS, type Action } from './dependances.types';

/** Corps de `POST /dependances/:entite/verdicts`. */
export class VerdictsListeDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids!: string[];
}

/**
 * « Action possible ? » (ADR-007) — l'écran n'affiche un bouton que si l'action est
 * possible ; le serveur refuse lui-même (409) au moment de l'action.
 *
 * - `GET /dependances/:entite/:id` : verdicts des 4 actions ;
 * - `GET /dependances/:entite/:id/:action` : verdict d'une action
 *   (`supprimer` | `archiver` | `desarchiver` | `modifier`) ;
 * - `POST /dependances/:entite/verdicts` `{ ids }` : verdicts des 4 actions pour une
 *   liste (boutons d'une table), `{ [id]: { [action]: { possible, raison, code } } }`.
 */
@Controller('dependances')
@UseGuards(SupabaseAuthGuard)
export class DependancesController {
  constructor(private readonly dependances: DependancesService) {}

  @Post(':entite/verdicts')
  @HttpCode(200)
  liste(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entite') entite: string,
    @Body() dto: VerdictsListeDto,
  ) {
    return this.dependances.verifierListe(user, entite, dto.ids);
  }

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
