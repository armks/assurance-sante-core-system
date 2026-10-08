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

/** Demande de `POST /api/v1/adjudication/simuler` (contrat snake_case, ADR-005). */
export interface DemandeSimulation {
  police_id: string;
  /** Personne soignée : titulaire OU bénéficiaire (exclusifs). */
  adherent_id: string | null;
  beneficiaire_id: string | null;
  etablissement_id: string | null;
  /** `YYYY-MM-DD` — date des soins (éligibilité, tarif conventionné). */
  date_reference: string | null;
  /**
   * Évaluées dans l'ordre : chaque ligne consomme le plafond annuel de sa
   * garantie. `acte_dossier_id` : ses lignes de facturation déjà en base sont
   * exclues du cumul (acte en cours de (re)facturation) ; `date_soins` :
   * `YYYY-MM-DD`, à défaut `date_reference`.
   */
  lignes: {
    garantie_id: string;
    montant: string;
    code_acte: string | null;
    acte_dossier_id: string | null;
    date_soins: string | null;
  }[];
}

/** Réponse de la simulation : une entrée par ligne, dans l'ordre. */
export interface ResultatSimulation {
  lignes: {
    decision: 'AUTO_ADJUDIQUE' | 'REVUE_MANUELLE' | 'REJETE';
    montant_couvert: number;
    plafond_restant_apres: number | null;
    codes_rejet: string[];
    /** Tarif conventionné appliqué au calcul (trace sur l'acte, prisma/sql/074). */
    tarif_conventionne_id?: string | null;
  }[];
}

/**
 * État des plafonds annuels d'une famille (`POST /api/v1/adjudication/plafonds`,
 * prisma/sql/069) : calculé par le microservice, mêmes cumuls et même période que
 * l'adjudication. Montants restants `null` = pas de plafond de ce niveau.
 */
export interface EtatPlafondsFamille {
  periode: { mode: 'ANNEE_POLICE' | 'ANNEE_CIVILE'; debut: string; fin: string };
  garanties: {
    garantie_id: string;
    categorie_acte: string;
    plafond_personne: number | null;
    plafond_famille: number | null;
    consomme_famille: number | null;
    restant_famille: number | null;
    personnes: {
      adherent_id: string | null;
      beneficiaire_id: string | null;
      consomme: number;
      restant: number | null;
    }[];
  }[];
}

/**
 * Messages présentés aux utilisateurs quand le calcul de la prise en charge
 * (microservice) est indisponible : ce qui s'est passé et quoi faire, JAMAIS de
 * détail technique — celui-ci reste dans les logs et l'audit.
 */
export const MESSAGES_INDISPONIBILITE = {
  facturation:
    "Le calcul de la prise en charge par l'assurance est momentanément indisponible : la facture n'a pas été émise. Réessayez dans quelques minutes.",
  dispensation:
    "Le calcul de la prise en charge par l'assurance est momentanément indisponible : la dispensation n'a pas été préparée. Réessayez dans quelques minutes.",
  paiementDispensation:
    "Le paiement est bien enregistré. La demande de remboursement à l'assurance n'a pas pu être traitée pour le moment : elle reste en attente et sera reprise par l'assureur. Aucune action n'est nécessaire de votre part.",
  reclamation:
    "Le calcul de la prise en charge par l'assurance est momentanément indisponible. La réclamation est remise en attente : réessayez dans quelques minutes.",
  reclamationErreur:
    "Le calcul de la prise en charge n'a pas pu aboutir. La réclamation est remise en attente : réessayez, et contactez le support si le problème persiste.",
  plafonds:
    'Le suivi des plafonds annuels est momentanément indisponible. Réessayez dans quelques minutes.',
} as const;

/**
 * État du microservice : `UP` (répond et joint sa base), `DOWN` (répond mais
 * n'est pas prêt, ex. base injoignable), `INJOIGNABLE` (aucune réponse).
 * `detail` ne contient jamais d'URL ni de secret.
 */
export interface SanteAdjudication {
  statut: 'UP' | 'DOWN' | 'INJOIGNABLE';
  latenceMs: number | null;
  baseDeDonnees: 'UP' | 'DOWN' | 'INCONNU';
  detail: string | null;
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
  private readonly timeoutSanteMs = Number(
    process.env.ADJUDICATION_SANTE_TIMEOUT_MS ?? 3_000,
  );

  /** Appelle `POST /api/v1/adjudication/{reclamationId}/evaluer`. */
  async evaluer(reclamationId: string): Promise<DecisionAdjudication> {
    return this.appeler<DecisionAdjudication>(
      `/api/v1/adjudication/${reclamationId}/evaluer`,
    );
  }

  /**
   * Appelle `POST /api/v1/adjudication/simuler` (ADR-005) : part assurance
   * calculée par le microservice, SANS écriture — même règle et même cumul
   * annuel que l'adjudication. Une entrée de résultat par ligne, dans l'ordre.
   */
  async simuler(demande: DemandeSimulation): Promise<ResultatSimulation> {
    return this.appeler<ResultatSimulation>('/api/v1/adjudication/simuler', demande);
  }

  /**
   * Appelle `POST /api/v1/adjudication/plafonds` : consommé et restant, par
   * personne et pour la famille, de chaque garantie plafonnée — sans écriture.
   * `titulaireId` = l'adhérent titulaire de la famille.
   */
  async etatPlafonds(policeId: string, titulaireId: string): Promise<EtatPlafondsFamille> {
    return this.appeler<EtatPlafondsFamille>('/api/v1/adjudication/plafonds', {
      police_id: policeId,
      adherent_id: titulaireId,
    });
  }

  /**
   * Disponibilité du microservice (`GET /readyz`, non authentifié) : il répond ET
   * joint sa base. Ne lève jamais : renvoie un état exploitable par la
   * supervision (`GET /api/v1/sante`, santé système superadmin). Timeout court.
   */
  async verifierSante(): Promise<SanteAdjudication> {
    const debut = Date.now();
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), this.timeoutSanteMs);
    try {
      const reponse = await fetch(`${this.baseUrl}/readyz`, {
        signal: controleur.signal,
      });
      const latenceMs = Date.now() - debut;
      const corps = (await reponse.json().catch(() => null)) as {
        status?: string;
        database?: string;
        detail?: string;
      } | null;
      if (reponse.ok && corps?.status === 'UP') {
        return { statut: 'UP', latenceMs, baseDeDonnees: 'UP', detail: null };
      }
      return {
        statut: 'DOWN',
        latenceMs,
        baseDeDonnees: corps?.database === 'UP' ? 'UP' : 'DOWN',
        detail: corps?.detail ?? `HTTP ${reponse.status}`,
      };
    } catch (e) {
      return {
        statut: 'INJOIGNABLE',
        latenceMs: null,
        baseDeDonnees: 'INCONNU',
        detail:
          e instanceof Error && e.name === 'AbortError'
            ? `timeout après ${this.timeoutSanteMs} ms`
            : 'connexion impossible',
      };
    } finally {
      clearTimeout(minuteur);
    }
  }

  private async appeler<T>(chemin: string, corps?: unknown): Promise<T> {
    if (!this.secret) {
      throw new AdjudicationInjoignableError(
        'SERVICE_JWT_SECRET non défini côté apps/api',
      );
    }

    const url = `${this.baseUrl}${chemin}`;
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
        ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
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
      return JSON.parse(texte) as T;
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
