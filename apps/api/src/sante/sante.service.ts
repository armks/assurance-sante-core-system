import { Injectable, Logger } from '@nestjs/common';
import {
  AdjudicationClientService,
  type SanteAdjudication,
} from '../adjudication-client/adjudication-client.service';
import { PrismaService } from '../prisma/prisma.service';

export interface SantePlateforme {
  /** `UP` si tout répond ; `DEGRADE` sinon (facturation et comptoir pharmacie bloqués). */
  statut: 'UP' | 'DEGRADE';
  api: { statut: 'UP'; baseDeDonnees: 'UP' | 'DOWN' };
  adjudication: SanteAdjudication;
  horodatage: string;
}

/**
 * État de la plateforme pour la supervision. Le microservice d'adjudication est
 * indispensable depuis ADR-005 : sans lui, aucune facture tiers payant ni
 * dispensation (503). Aucune donnée métier, aucune URL, aucun secret.
 */
@Injectable()
export class SanteService {
  private readonly logger = new Logger(SanteService.name);
  private dernierEtat: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adjudication: AdjudicationClientService,
  ) {}

  async etat(): Promise<SantePlateforme> {
    const [baseDeDonnees, adjudication] = await Promise.all([
      this.prisma.$queryRawUnsafe('SELECT 1').then(
        () => 'UP' as const,
        () => 'DOWN' as const,
      ),
      this.adjudication.verifierSante(),
    ]);
    const statut =
      baseDeDonnees === 'UP' && adjudication.statut === 'UP' ? 'UP' : 'DEGRADE';
    // trace les changements d'état d'un composant (pas chaque sonde)
    const cle = `${baseDeDonnees}/${adjudication.statut}`;
    if (cle !== this.dernierEtat) {
      const message = `Santé plateforme : ${statut} (base API ${baseDeDonnees}, adjudication ${adjudication.statut}${
        adjudication.detail ? ` — ${adjudication.detail}` : ''
      })`;
      if (statut === 'UP') this.logger.log(message);
      else this.logger.error(message);
      this.dernierEtat = cle;
    }
    return {
      statut,
      api: { statut: 'UP', baseDeDonnees },
      adjudication,
      horodatage: new Date().toISOString(),
    };
  }
}
