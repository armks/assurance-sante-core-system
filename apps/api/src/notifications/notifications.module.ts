import { Logger, Module } from '@nestjs/common';

import { EmailModule } from '../email/email.module';
import { FOURNISSEUR_SMS, FournisseurSmsDesactive, type FournisseurSms } from './fournisseur-sms';
import { NotificationCodeService } from './notification-code.service';

/**
 * Choix de l'adaptateur SMS (`SMS_FOURNISSEUR`). Seul `desactive` existe : un adaptateur réel s'ajoute ici, avec sa clé
 * et après accord explicite — jamais d'envoi réel par défaut.
 */
function creerFournisseurSms(): FournisseurSms {
  const choix = process.env.SMS_FOURNISSEUR;
  if (choix && choix !== 'desactive') {
    new Logger('NotificationsModule').warn(`SMS_FOURNISSEUR="${choix}" : aucun adaptateur de ce nom — SMS désactivés.`);
  }
  return new FournisseurSmsDesactive();
}

@Module({
  imports: [EmailModule],
  providers: [{ provide: FOURNISSEUR_SMS, useFactory: creerFournisseurSms }, NotificationCodeService],
  exports: [NotificationCodeService],
})
export class NotificationsModule {}
