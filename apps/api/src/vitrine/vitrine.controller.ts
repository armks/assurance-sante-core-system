import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DemandeVitrineDto, InscriptionNewsletterDto } from './dto/vitrine.dto';
import { VitrineService } from './vitrine.service';

/**
 * Endpoints PUBLICS de la page d'accueil (aucun `SupabaseAuthGuard`) :
 *   POST /api/v1/public/demandes    Contact, Devenir partenaire, Adhésion
 *   POST /api/v1/public/newsletter  inscription newsletter
 * Protégés par limiteur de débit + pot de miel (VitrineService).
 */
@Controller('public')
export class VitrineController {
  constructor(private readonly vitrine: VitrineService) {}

  @Post('demandes')
  @HttpCode(201)
  envoyerDemande(@Body() dto: DemandeVitrineDto, @Req() req: Request) {
    return this.vitrine.envoyerDemande(dto, ipClient(req));
  }

  @Post('newsletter')
  @HttpCode(201)
  inscrireNewsletter(@Body() dto: InscriptionNewsletterDto, @Req() req: Request) {
    return this.vitrine.inscrireNewsletter(dto, ipClient(req));
  }
}

/**
 * IP du visiteur : le front Next.js appelle l'API côté serveur et transmet
 * l'IP d'origine dans X-Forwarded-For (1re valeur). Cet en-tête est falsifiable
 * par un appel direct à l'API : c'est pourquoi le limiteur a aussi un plafond
 * GLOBAL, indépendant de l'IP.
 */
export function ipClient(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const premiere = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return premiere || req.ip || 'inconnue';
}
