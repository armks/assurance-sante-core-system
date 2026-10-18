import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessagerieHub } from './messagerie.hub';
import { MessagerieStockage } from './messagerie-stockage';
import { cleMois, debutDuMois } from './messagerie-regles';

const CLE_ETAT = 'dernier_mois_purge';

/**
 * Purge mensuelle : toutes les conversations, tous les messages et tous les fichiers antérieurs au 1er du mois en cours (00h00, heure
 * d'Abidjan = UTC) sont supprimés. Idempotente : l'état « dernier mois purgé » évite toute répétition, et une purge manquée
 * (API arrêtée à minuit) est rattrapée au démarrage ou à la minute suivante.
 */
@Injectable()
export class MessageriePurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageriePurgeService.name);
  private minuteur: NodeJS.Timeout | null = null;
  private enCours = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stockage: MessagerieStockage,
    private readonly hub: MessagerieHub,
  ) {}

  onModuleInit(): void {
    if (process.env.JEST_WORKER_ID) return;
    void this.purgerSiNecessaire();
    this.minuteur = setInterval(() => void this.purgerSiNecessaire(), 60_000);
    this.minuteur.unref();
  }

  onModuleDestroy(): void {
    if (this.minuteur) clearInterval(this.minuteur);
  }

  /** Purge si le mois courant n'a pas encore été traité. Renvoie `true` si une purge a eu lieu. */
  async purgerSiNecessaire(maintenant: Date = new Date()): Promise<boolean> {
    if (this.enCours) return false;
    this.enCours = true;
    try {
      const mois = cleMois(maintenant);
      const etat = await this.prisma.chatPurgeEtat.findUnique({ where: { cle: CLE_ETAT } });
      if (etat?.valeur === mois) return false;
      const coupure = debutDuMois(maintenant);
      const fichiers = await this.prisma.chatMessage.findMany({
        where: { fichierChemin: { not: null }, OR: [{ createdAt: { lt: coupure } }, { conversation: { createdAt: { lt: coupure } } }] },
        select: { fichierChemin: true },
      });
      // fichiers d'abord : si le stockage refuse, rien n'est supprimé en base et la purge est retentée
      await this.stockage.supprimer(fichiers.map((f) => f.fichierChemin!));
      const supprimees = await this.prisma.chatConversation.deleteMany({ where: { createdAt: { lt: coupure } } });
      const messages = await this.prisma.chatMessage.deleteMany({ where: { createdAt: { lt: coupure } } });
      await this.prisma.chatPurgeEtat.upsert({
        where: { cle: CLE_ETAT },
        create: { cle: CLE_ETAT, valeur: mois },
        update: { valeur: mois, misAJour: new Date() },
      });
      this.logger.log(`Purge mensuelle ${mois} : ${supprimees.count} conversation(s), ${messages.count} message(s) hors conversation, ${fichiers.length} fichier(s) supprimés.`);
      this.hub.publierATous({ type: 'purge' });
      return true;
    } catch (err) {
      this.logger.error(`Purge mensuelle de la messagerie en échec (retentée) : ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      this.enCours = false;
    }
  }
}
