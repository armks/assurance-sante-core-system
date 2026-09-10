import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

/** Décision structurée renvoyée par le microservice Java (v12 §3). */
export interface DecisionAdjudication {
  decision: 'AUTO_ADJUDIQUE' | 'REVUE_MANUELLE' | 'REJETE';
  montant_rembourse: number;
  codes_rejet: string[];
  plafond_restant_apres: number | null;
  duree_traitement_ms: number;
}

/** Le microservice n'a pas répondu (réseau coupé, timeout, DNS…). */
export class AdjudicationInjoignableError extends Error {
  constructor(cause: string) {
    super(`Microservice d'adjudication injoignable : ${cause}`);
    this.name = 'AdjudicationInjoignableError';
  }
}

/** Le microservice a répondu, mais avec une erreur (4xx / 5xx). */
export class AdjudicationRefusError extends Error {
  constructor(
    public readonly statut: number,
    public readonly corps: string,
  ) {
    super(`Microservice d'adjudication : HTTP ${statut} — ${corps}`);
    this.name = 'AdjudicationRefusError';
  }
}

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64url');

/**
 * Client HTTP vers `adjudication-service` (Java). Signe chaque requête avec un
 * JWT de service HMAC-SHA256 (secret partagé `SERVICE_JWT_SECRET`, jamais en dur),
 * court (120 s), et applique un timeout dur sur l'appel.
 */
@Injectable()
export class AdjudicationClientService {
  private readonly logger = new Logger(AdjudicationClientService.name);

  private readonly baseUrl = (
    process.env.ADJUDICATION_SERVICE_URL ?? 'http://localhost:8899'
  ).replace(/\/$/, '');
  private readonly secret = process.env.SERVICE_JWT_SECRET ?? '';
  private readonly timeoutMs = Number(
    process.env.ADJUDICATION_TIMEOUT_MS ?? 12_000,
  );

  /** Appelle `POST /api/v1/adjudication/{reclamationId}/evaluer`. */
  async evaluer(reclamationId: string): Promise<DecisionAdjudication> {
    if (!this.secret) {
      throw new AdjudicationInjoignableError(
        'SERVICE_JWT_SECRET non défini côté apps/api',
      );
    }

    const url = `${this.baseUrl}/api/v1/adjudication/${reclamationId}/evaluer`;
    const jeton = this.signerJetonService();
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), this.timeoutMs);

    let reponse: Response;
    try {
      reponse = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jeton}`,
          'Content-Type': 'application/json',
        },
        signal: controleur.signal,
      });
    } catch (e) {
      const cause =
        e instanceof Error && e.name === 'AbortError'
          ? `timeout après ${this.timeoutMs} ms`
          : e instanceof Error
            ? e.message
            : 'erreur réseau inconnue';
      throw new AdjudicationInjoignableError(cause);
    } finally {
      clearTimeout(minuteur);
    }

    const texte = await reponse.text();
    if (!reponse.ok) {
      throw new AdjudicationRefusError(reponse.status, texte.slice(0, 500));
    }

    try {
      return JSON.parse(texte) as DecisionAdjudication;
    } catch {
      throw new AdjudicationRefusError(
        reponse.status,
        `réponse illisible : ${texte.slice(0, 200)}`,
      );
    }
  }

  /** JWT HS256 minimal (crypto JDK-like, aucune lib tierce), valable 120 s. */
  private signerJetonService(): string {
    const maintenant = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(
      JSON.stringify({
        iss: 'apps-api-claims',
        aud: 'adjudication-service',
        iat: maintenant,
        exp: maintenant + 120,
      }),
    );
    const signature = b64url(
      createHmac('sha256', this.secret)
        .update(`${header}.${payload}`)
        .digest(),
    );
    return `${header}.${payload}.${signature}`;
  }
}
