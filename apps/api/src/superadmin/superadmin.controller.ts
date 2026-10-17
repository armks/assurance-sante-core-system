import { Throttle } from '@nestjs/throttler';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  ConfirmerActionDto,
  InitierCreationOrganisationDto,
  InitierProlongationDto,
  InitierSuspensionDto,
} from './dto/superadmin.dto';
import { SuperadminActionsService } from './superadmin-actions.service';

/**
 * Endpoints REST des actions superadmin sensibles (v14 §5, PROMPT 22) — toutes
 * en deux temps : `initier*` envoie un code par e-mail, `actions/confirmer`
 * exécute réellement.
 */
@Controller('superadmin')
@UseGuards(SupabaseAuthGuard)
export class SuperadminController {
  constructor(private readonly actions: SuperadminActionsService) {}

  @Post('organisations/initier')
  initierCreation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InitierCreationOrganisationDto,
  ) {
    return this.actions.initierCreationOrganisation(user, dto);
  }

  @Post('organisations/:id/suspension/initier')
  initierSuspension(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InitierSuspensionDto,
  ) {
    return this.actions.initierSuspensionOrganisation(user, id, dto);
  }

  @Post('organisations/:id/prolongation/initier')
  initierProlongation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InitierProlongationDto,
  ) {
    return this.actions.initierProlongationOrganisation(user, id, dto);
  }

  @Throttle({ default: { limit: 8, ttl: 60_000 } }) // anti force brute sur les codes
  @Post('actions/confirmer')
  confirmer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmerActionDto,
  ) {
    return this.actions.confirmerAction(user, dto);
  }

  @Get('actions')
  listerEnAttente(@CurrentUser() user: AuthenticatedUser) {
    return this.actions.listerActionsEnAttente(user);
  }

  @Post('actions/:id/annuler')
  annuler(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.actions.annulerAction(user, id);
  }
}
