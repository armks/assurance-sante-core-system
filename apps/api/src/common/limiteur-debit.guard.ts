import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Limiteur de débit par UTILISATEUR (et non par adresse IP) : toutes les requêtes arrivent du serveur Next.js, une
 * limite par IP serait partagée par tous les utilisateurs. Clé = identifiant (`sub`) du jeton Bearer ; sans jeton
 * (routes publiques), première adresse de `X-Forwarded-For` transmise par le serveur web, sinon l'IP de la connexion.
 * La clé ne sert qu'à compter : un jeton falsifié est de toute façon refusé (401) par la garde d'authentification.
 */
@Injectable()
export class LimiteurDebitGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const entetes = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
    const auth = entetes.authorization;
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
      try {
        const charge = auth.split(' ')[1]?.split('.')[1];
        const sub = charge ? (JSON.parse(Buffer.from(charge, 'base64url').toString('utf8')) as { sub?: string }).sub : undefined;
        if (sub) return `u:${sub}`;
      } catch {
        // jeton illisible : repli sur l'adresse
      }
    }
    const transmise = entetes['x-forwarded-for'];
    const ip = (Array.isArray(transmise) ? transmise[0] : transmise)?.split(',')[0]?.trim();
    return `ip:${ip || String(req.ip ?? 'inconnue')}`;
  }
}
