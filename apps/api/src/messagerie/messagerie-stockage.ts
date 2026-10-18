import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

const BUCKET = 'messagerie';

/** Fichiers joints : bucket privé Supabase Storage « messagerie » (accès par la clé de service de l'API uniquement). */
@Injectable()
export class MessagerieStockage {
  private readonly logger = new Logger(MessagerieStockage.name);

  private get base(): string {
    return `${(process.env.SUPABASE_URL ?? '').replace(/\/$/, '')}/storage/v1`;
  }

  private get cle(): string {
    return process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  }

  private assertStockage(): void {
    if (!process.env.SUPABASE_URL || !this.cle) {
      throw new ServiceUnavailableException('Stockage des fichiers indisponible : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.');
    }
  }

  async televerser(chemin: string, contenu: Buffer, type: string): Promise<void> {
    this.assertStockage();
    const res = await fetch(`${this.base}/object/${BUCKET}/${chemin}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cle}`, apikey: this.cle, 'Content-Type': type },
      body: contenu as unknown as BodyInit,
    });
    if (!res.ok) throw new ServiceUnavailableException(`Téléversement refusé (${res.status}).`);
  }

  async telecharger(chemin: string): Promise<Buffer> {
    this.assertStockage();
    const res = await fetch(`${this.base}/object/${BUCKET}/${chemin}`, { headers: { Authorization: `Bearer ${this.cle}`, apikey: this.cle } });
    if (!res.ok) throw new ServiceUnavailableException(`Fichier indisponible (${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Supprime des objets par lots ; lève une erreur si le stockage refuse (la purge est alors retentée). */
  async supprimer(chemins: string[]): Promise<void> {
    if (chemins.length === 0) return;
    this.assertStockage();
    for (let i = 0; i < chemins.length; i += 100) {
      const lot = chemins.slice(i, i + 100);
      const res = await fetch(`${this.base}/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.cle}`, apikey: this.cle, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: lot }),
      });
      if (!res.ok) {
        this.logger.error(`Suppression de ${lot.length} fichier(s) refusée (${res.status}).`);
        throw new ServiceUnavailableException(`Suppression des fichiers refusée (${res.status}).`);
      }
    }
  }
}
