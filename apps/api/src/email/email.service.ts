import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

/** Adresse d'expédition — provisoire (bac à sable Resend).
 *  À remplacer par un domaine vérifié (ex: no-reply@assurance-sante.ci). */
const EXPEDITEUR = 'noreply@africonnexion.net';

export interface ResultatEnvoi {
  envoye: boolean;
  id?: string;
  erreur?: string;
}

/**
 * EmailService — enveloppe unique et générique de l'envoi d'e-mails (Resend).
 * Réutilisable par tous les besoins futurs (invitations, notifications, alertes…)
 * via la seule méthode `envoyerEmail(destinataire, sujet, contenu)`.
 *
 * Si `RESEND_API_KEY` est absent, les envois sont journalisés mais non émis —
 * l'appelant reçoit `{ envoye: false }` et ne plante pas.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;

  constructor() {
    const cle = process.env.RESEND_API_KEY;
    this.resend = cle ? new Resend(cle) : null;
    if (!this.resend) {
      this.logger.warn(
        'RESEND_API_KEY absent — les e-mails seront journalisés mais pas envoyés.',
      );
    }
  }

  /**
   * @param destinataire une ou plusieurs adresses e-mail
   * @param sujet objet du message
   * @param contenu corps du message (texte brut)
   * @param options.replyTo adresse de réponse (ex. l'auteur d'un formulaire public)
   */
  async envoyerEmail(
    destinataire: string | string[],
    sujet: string,
    contenu: string,
    options: { replyTo?: string } = {},
  ): Promise<ResultatEnvoi> {
    const to = Array.isArray(destinataire) ? destinataire : [destinataire];

    if (!this.resend) {
      this.logger.warn(
        `E-mail NON envoyé (Resend non configuré) — à: ${to.join(', ')} — objet: « ${sujet} »`,
      );
      return { envoye: false, erreur: 'Resend non configuré' };
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: EXPEDITEUR,
        to,
        subject: sujet,
        text: contenu,
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      });
      if (error) {
        this.logger.error(
          `Resend a renvoyé une erreur pour « ${sujet} » : ${JSON.stringify(error)}`,
        );
        return { envoye: false, erreur: error.message ?? 'erreur Resend' };
      }
      this.logger.log(`E-mail envoyé (${data?.id}) — objet: « ${sujet} »`);
      return { envoye: true, id: data?.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'erreur inconnue';
      this.logger.error(`Échec envoi e-mail « ${sujet} » : ${msg}`);
      return { envoye: false, erreur: msg };
    }
  }
}
