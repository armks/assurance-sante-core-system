import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AnnuaireQueryDto, DemarrerConversationDto, EnvoyerFichierDto, EnvoyerMessageDto, MessagesQueryDto } from './messagerie.dto';
import { TAILLE_MAX_FICHIER } from './messagerie-regles';
import { MessagerieService, type FichierRecu } from './messagerie.service';

/** Messagerie interne instantanée : conversations privées 1 à 1 sur invitation, fichiers joints, flux temps réel (SSE). */
@Controller('messagerie')
@UseGuards(SupabaseAuthGuard)
export class MessagerieController {
  constructor(private readonly messagerie: MessagerieService) {}

  /** Flux d'événements (nouveau message, invitation, lecture, saisie…) de l'utilisateur connecté. */
  @Sse('flux')
  async flux(@CurrentUser() user: AuthenticatedUser) {
    return this.messagerie.flux(user);
  }

  @Get('annuaire')
  annuaire(@CurrentUser() user: AuthenticatedUser, @Query() q: AnnuaireQueryDto) {
    return this.messagerie.annuaire(user, q.q);
  }

  @Get('conversations')
  conversations(@CurrentUser() user: AuthenticatedUser) {
    return this.messagerie.conversations(user);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('conversations')
  demarrer(@CurrentUser() user: AuthenticatedUser, @Body() dto: DemarrerConversationDto) {
    return this.messagerie.demarrer(user, dto.destinataireId, dto.contenu);
  }

  @Get('conversations/:id/messages')
  messages(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: MessagesQueryDto) {
    return this.messagerie.messages(user, id, q.avant);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('conversations/:id/messages')
  envoyer(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EnvoyerMessageDto) {
    return this.messagerie.envoyer(user, id, dto.contenu);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('conversations/:id/fichiers')
  @UseInterceptors(FileInterceptor('fichier', { limits: { fileSize: TAILLE_MAX_FICHIER, files: 1 } }))
  envoyerFichier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() fichier: FichierRecu | undefined,
    @Body() dto: EnvoyerFichierDto,
  ) {
    return this.messagerie.envoyerFichier(user, id, fichier, dto.contenu);
  }

  @Get('conversations/:id/messages/:messageId/fichier')
  async fichier(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string) {
    const f = await this.messagerie.telechargerFichier(user, id, messageId);
    return new StreamableFile(f.buffer, { type: f.type, disposition: `attachment; filename*=UTF-8''${encodeURIComponent(f.nom)}` });
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('conversations/:id/accepter')
  accepter(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messagerie.accepter(user, id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('conversations/:id/refuser')
  refuser(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messagerie.refuser(user, id);
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('conversations/:id/lu')
  lu(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messagerie.marquerLu(user, id);
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('conversations/:id/saisie')
  saisie(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messagerie.saisie(user, id);
  }
}
