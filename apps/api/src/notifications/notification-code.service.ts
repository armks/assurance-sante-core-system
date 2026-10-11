import { Inject, Injectable, Logger } from '@nestjs/common';

import { EmailService } from '../email/email.service';
import { FOURNISSEUR_SMS, type FournisseurSms } from './fournisseur-sms';

export type CanalCode = 'EMAIL' | 'SMS';
export type StatutEnvoi = 'ENVOYE' | 'NON_ENVOYE_DESACTIVE' | 'ECHEC';

/** Envoi réel des e-mails de code : explicitement activé (sinon journalisé, rien ne part). */
export function emailReelActive(): boolean {
  return process.env.CODES_CONSULTATION_EMAIL_REEL === 'oui';
}

/**
 * Envoie le code de consultation au contact ENREGISTRÉ sur la fiche (jamais une valeur saisie à l'accueil).
 * Le message indique l'établissement et le type d'acte. Aucun envoi réel tant que le canal n'est pas activé.
 */
@Injectable()
export class NotificationCodeService {
  private readonly logger = new Logger(NotificationCodeService.name);

  constructor(
    private readonly email: EmailService,
    @Inject(FOURNISSEUR_SMS) private readonly sms: FournisseurSms,
  ) {}

  /** Disponibilité des canaux (l'accueil voit le SMS grisé tant qu'aucun fournisseur n'est actif). */
  canauxDisponibles(): Record<CanalCode, { actif: boolean; raison?: string }> {
    return {
      EMAIL: emailReelActive() ? { actif: true } : { actif: true, raison: 'Envoi réel des e-mails désactivé : le code reste visible dans l’application du patient.' },
      SMS: this.sms.estActif() ? { actif: true } : { actif: false, raison: 'SMS indisponible : fournisseur non configuré.' },
    };
  }

  smsActif(): boolean {
    return this.sms.estActif();
  }

  messageCode(code: string, etablissement: string, acte: string): string {
    return `Code de consultation ${code} — ${etablissement} — ${acte}. Valable 48 h. Ne le communiquez qu’à l’accueil de cet établissement.`;
  }

  async envoyer(
    canal: CanalCode,
    destinataire: string,
    code: string,
    etablissement: string,
    acte: string,
  ): Promise<{ statut: StatutEnvoi; detail: string }> {
    const message = this.messageCode(code, etablissement, acte);
    if (canal === 'SMS') {
      if (!this.sms.estActif()) return { statut: 'NON_ENVOYE_DESACTIVE', detail: 'Fournisseur SMS non configuré.' };
      const r = await this.sms.envoyer(destinataire, message).catch((e: unknown) => ({ envoye: false, erreur: String(e) }));
      return r.envoye ? { statut: 'ENVOYE', detail: this.sms.nom } : { statut: 'ECHEC', detail: r.erreur ?? 'Échec SMS.' };
    }
    if (!emailReelActive()) {
      this.logger.warn(`E-mail de code NON envoyé (envoi réel désactivé) — établissement « ${etablissement} », acte « ${acte} ».`);
      return { statut: 'NON_ENVOYE_DESACTIVE', detail: 'Envoi réel des e-mails désactivé.' };
    }
    const r = await this.email.envoyerEmail(destinataire, `Code de consultation — ${etablissement}`, message);
    return r.envoye ? { statut: 'ENVOYE', detail: r.id ?? 'resend' } : { statut: 'ECHEC', detail: r.erreur ?? 'Échec e-mail.' };
  }
}
