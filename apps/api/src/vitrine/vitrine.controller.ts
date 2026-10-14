import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DemandeVitrineDto, InscriptionNewsletterDto } from './dto/vitrine.dto';
import { EvenementsService } from './evenements.service';
import { PartenairesVitrineService } from './partenaires-vitrine.service';
import { VitrineService } from './vitrine.service';

/**
 * Endpoints PUBLICS de la page d'accueil (aucun `SupabaseAuthGuard`) :
 *   POST /api/v1/public/demandes    Contact, Devenir partenaire, Adhésion
 *   POST /api/v1/public/newsletter  inscription newsletter
 *   GET  /api/v1/public/statistiques compteurs agrégés (arrondis, seuillés, arrêtés la veille)
 *                                    (?organisation={slug} : ceux de cette société)
 *   GET  /api/v1/public/evenements   5 événements au plus de l'organisation vitrine
 *                                    (?organisation={slug} : ceux de cette société)
 *   GET  /api/v1/public/organisations/:slug  fiche publique d'une société (page /{slug})
 * Protégés par limiteur de débit + pot de miel (VitrineService).
 */
@Controller('public')
export class VitrineController {
  constructor(
    private readonly vitrine: VitrineService,
    private readonly evenements: EvenementsService,
    private readonly partenaires: PartenairesVitrineService,
  ) {}

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

  /** Compteurs agrégés, arrondis et seuillés (StatistiquesService). */
  @Get('statistiques')
  obtenirStatistiques(@Req() req: Request, @Query('organisation') organisation?: string) {
    const slug = typeof organisation === 'string' && organisation !== '' ? organisation.toLowerCase() : undefined;
    return this.vitrine.obtenirStatistiques(ipClient(req), slug);
  }

  /** Carrousel du bloc « Qui sommes-nous » (EvenementsService.publics). */
  @Get('evenements')
  obtenirEvenements(@Req() req: Request, @Query('organisation') organisation?: string) {
    const slug = typeof organisation === 'string' && /^[a-z0-9-]{2,60}$/.test(organisation) ? organisation : undefined;
    if (organisation !== undefined && !slug) return [];
    return this.evenements.publics(ipClient(req), slug);
  }

  /** Logos des partenaires du bandeau défilant sous la bannière (PartenairesVitrineService.publics) : ceux de la société `?organisation={slug}`, sinon de l'organisation vitrine. */
  @Get('partenaires')
  obtenirPartenaires(@Req() req: Request, @Query('organisation') organisation?: string) {
    const slug = typeof organisation === 'string' && /^[a-z0-9-]{2,60}$/.test(organisation) ? organisation : undefined;
    if (organisation !== undefined && !slug) return [];
    return this.partenaires.publics(ipClient(req), slug);
  }

  /** Nom, chemin et logo d'une société active (page /{slug}) ; 404 sinon. */
  @Get('organisations/:slug')
  obtenirOrganisation(@Param('slug') slug: string, @Req() req: Request) {
    return this.vitrine.obtenirOrganisation(slug.toLowerCase(), ipClient(req));
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
