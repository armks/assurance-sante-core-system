import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { DemandeVitrineDto, InscriptionNewsletterDto } from './dto/vitrine.dto';
import { LimiteurRequetes, type ResultatLimite } from './limiteur-requetes';
import { StatistiquesService } from './statistiques.service';
import {
  LIBELLE_CATEGORIE,
  LIBELLE_TYPE_DEMANDE,
  LIMITE_DEMANDES,
  LIMITE_NEWSLETTER,
  LIMITE_STATISTIQUES,
} from './vitrine.types';

const MESSAGE_DEMANDE = 'Merci, votre demande a bien été envoyée. Nous vous répondons rapidement.';
const MESSAGE_NEWSLETTER = 'Merci, votre inscription est enregistrée.';

/**
 * VitrineService — formulaires de la page d'accueil publique (aucune
 * authentification) : demandes (Contact, Devenir partenaire, Adhésion)
 * transmises par e-mail à `CONTACT_EMAIL`, et inscriptions newsletter en base.
 *
 * Protection anti-spam : limiteur de débit (par IP + plafond global) et pot de
 * miel. Un pot de miel rempli renvoie EXACTEMENT la même réponse qu'un envoi
 * réussi, sans rien faire : le robot n'apprend pas qu'il a été détecté.
 */
@Injectable()
export class VitrineService {
  private readonly logger = new Logger(VitrineService.name);
  private readonly limiteDemandes = new LimiteurRequetes(LIMITE_DEMANDES);
  private readonly limiteNewsletter = new LimiteurRequetes(LIMITE_NEWSLETTER);
  private readonly limiteStatistiques = new LimiteurRequetes(LIMITE_STATISTIQUES);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly statistiques: StatistiquesService,
  ) {}

  async envoyerDemande(dto: DemandeVitrineDto, ip: string) {
    this.verifierLimite(this.limiteDemandes.consommer(ip));
    if (dto.siteWeb) {
      this.logger.warn(`Pot de miel déclenché (demande ${dto.type}) depuis ${ip} — ignorée.`);
      return { ok: true, message: MESSAGE_DEMANDE };
    }

    const destinataire = process.env.CONTACT_EMAIL?.trim();
    if (!destinataire) {
      this.logger.error('CONTACT_EMAIL absent : impossible de transmettre la demande du site.');
      throw new ServiceUnavailableException(
        'Le formulaire est momentanément indisponible. Merci de réessayer plus tard.',
      );
    }

    const libelle = LIBELLE_TYPE_DEMANDE[dto.type];
    const resultat = await this.email.envoyerEmail(
      destinataire,
      `[Site] ${libelle} - ${dto.structure}`,
      this.corpsDemande(dto, libelle),
      { replyTo: dto.email },
    );
    if (!resultat.envoye) {
      throw new ServiceUnavailableException(
        'Votre demande n’a pas pu être transmise. Merci de réessayer dans quelques minutes.',
      );
    }
    return { ok: true, message: MESSAGE_DEMANDE };
  }

  /** Idempotent : une adresse déjà inscrite (ou désinscrite) est simplement
   * (ré)activée, avec la même réponse — rien ne révèle qu'elle existait. */
  async inscrireNewsletter(dto: InscriptionNewsletterDto, ip: string) {
    this.verifierLimite(this.limiteNewsletter.consommer(ip));
    if (dto.siteWeb) {
      this.logger.warn(`Pot de miel déclenché (newsletter) depuis ${ip} — ignorée.`);
      return { ok: true, message: MESSAGE_NEWSLETTER };
    }
    const email = dto.email.toLowerCase();
    await this.prisma.newsletterAbonne.upsert({
      where: { email },
      create: { email },
      update: { deletedAt: null },
    });
    return { ok: true, message: MESSAGE_NEWSLETTER };
  }

  async obtenirStatistiques(ip: string) {
    this.verifierLimite(this.limiteStatistiques.consommer(ip));
    return this.statistiques.obtenir();
  }

  private verifierLimite(r: ResultatLimite): void {
    if (!r.autorise) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Trop de tentatives. Merci de réessayer dans ${Math.ceil(r.reessayerDansS / 60)} min.`,
          reessayerDansS: r.reessayerDansS,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private corpsDemande(dto: DemandeVitrineDto, libelle: string): string {
    const lignes = [
      `${libelle} reçue depuis la page d’accueil.`,
      '',
      `Structure : ${dto.structure}`,
      dto.categorie ? `Catégorie : ${LIBELLE_CATEGORIE[dto.categorie]}` : null,
      dto.effectif != null ? `Nombre estimé d’employés / d’adhérents : ${dto.effectif}` : null,
      dto.ville ? `Ville : ${dto.ville}` : null,
      ...this.lignesLocalisation(dto),
      `E-mail : ${dto.email}`,
      `Téléphone : ${dto.telephone}`,
      `Objet : ${dto.objet}`,
      '',
      dto.message ? `Message :\n${dto.message}` : '(aucun message)',
      '',
      'Répondre à cet e-mail écrit directement au demandeur.',
    ];
    return lignes.filter((l) => l !== null).join('\n');
  }

  /** Devenir partenaire : coordonnées (6 décimales ≈ 10 cm) et lien OpenStreetMap. */
  private lignesLocalisation(dto: DemandeVitrineDto): string[] {
    if (dto.type !== 'PARTENAIRE' || dto.latitude == null || dto.longitude == null) return [];
    const lat = dto.latitude.toFixed(6);
    const lon = dto.longitude.toFixed(6);
    return [
      `Latitude : ${lat}`,
      `Longitude : ${lon}`,
      `Carte : https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`,
    ];
  }
}
