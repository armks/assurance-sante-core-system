import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  AgendaQueryDto,
  CreneauxQueryDto,
  ListeRendezVousQueryDto,
  MedecinsQueryDto,
  ModifierRendezVousDto,
  MotifRendezVousDto,
  ProposerRendezVousDto,
  RechercheQueryDto,
  RegleAgendaDto,
} from './rendez-vous.dto';
import { RendezVousService } from './rendez-vous.service';

/**
 * Agenda de présence des médecins et rendez-vous des patients : l'accueil et les médecins de l'établissement règlent l'agenda et traitent
 * les propositions ; la secrétaire de l'assurance et l'exploitation proposent ; l'adhérent consulte les siens (lecture seule).
 */
@Controller('rendez-vous')
@UseGuards(SupabaseAuthGuard)
export class RendezVousController {
  constructor(private readonly rdv: RendezVousService) {}

  @Get('medecins')
  medecins(@CurrentUser() user: AuthenticatedUser, @Query() q: MedecinsQueryDto) {
    return this.rdv.medecins(user, q.etablissementId);
  }

  @Get('agenda')
  agenda(@CurrentUser() user: AuthenticatedUser, @Query() q: AgendaQueryDto) {
    return this.rdv.agenda(user, q.medecinId);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('agenda')
  ajouterRegle(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegleAgendaDto) {
    return this.rdv.ajouterRegle(user, dto);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Delete('agenda/:id')
  supprimerRegle(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rdv.supprimerRegle(user, id);
  }

  @Get('creneaux')
  creneaux(@CurrentUser() user: AuthenticatedUser, @Query() q: CreneauxQueryDto) {
    return this.rdv.creneaux(user, q.medecinId, q.du, q.au, q.sauf);
  }

  @Get('etablissements')
  etablissements(@CurrentUser() user: AuthenticatedUser, @Query() q: RechercheQueryDto) {
    return this.rdv.etablissements(user, q.q);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('patients')
  patients(@CurrentUser() user: AuthenticatedUser, @Query() q: RechercheQueryDto) {
    return this.rdv.patients(user, q.q);
  }

  @Get()
  lister(@CurrentUser() user: AuthenticatedUser, @Query() q: ListeRendezVousQueryDto) {
    return this.rdv.lister(user, q.statut);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  proposer(@CurrentUser() user: AuthenticatedUser, @Body() dto: ProposerRendezVousDto) {
    return this.rdv.proposer(user, dto);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post(':id/confirmer')
  confirmer(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rdv.confirmer(user, id);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post(':id/refuser')
  refuser(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MotifRendezVousDto) {
    return this.rdv.refuser(user, id, dto.motif);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post(':id/modifier')
  modifier(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ModifierRendezVousDto) {
    return this.rdv.modifier(user, id, dto);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post(':id/annuler')
  annuler(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MotifRendezVousDto) {
    return this.rdv.annuler(user, id, dto.motif);
  }
}
