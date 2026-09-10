import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * Module `email/` — enveloppe d'envoi d'e-mails (Resend). `@Global` : disponible
 * partout sans réimport, comme un utilitaire transverse.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
