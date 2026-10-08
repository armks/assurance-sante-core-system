import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

interface AuthUser {
  id: string;
  email?: string;
}

/**
 * SupabaseAdminService — appels à l'API Admin GoTrue de Supabase, côté serveur
 * UNIQUEMENT (clé `service_role`). Utilisé par le flux d'invitation.
 *
 * Règle du skill : jamais de mot de passe généré ou visible côté serveur. Ce
 * service ne fait que (1) créer le compte auth + envoyer l'e-mail d'invitation
 * (`inviteUserByEmail`), et (2) poser le mot de passe choisi par l'invité
 * lui-même au moment de l'acceptation.
 *
 * Appels via `fetch` natif (User-Agent Node, pas « navigateur ») — l'API Admin
 * refuse les clés `sb_secret_` présentées depuis un contexte navigateur.
 */
@Injectable()
export class SupabaseAdminService {
  private readonly logger = new Logger(SupabaseAdminService.name);
  private readonly baseUrl = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  private readonly serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  private assertConfig(): void {
    if (!this.baseUrl || !this.serviceKey) {
      throw new InternalServerErrorException(
        'Configuration Supabase Admin absente (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
      );
    }
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Équivalent `supabase.auth.admin.inviteUserByEmail` : crée le compte auth
   * (sans mot de passe) et déclenche l'e-mail d'invitation. Si l'envoi échoue
   * (SMTP Supabase indisponible, limite d'envoi…), le compte est tout de même
   * créé — sans quoi « Copier le lien » et l'acceptation seraient impossibles —
   * mais l'échec n'est JAMAIS masqué : `emailEnvoye: false` est enregistré sur
   * l'invitation, affiché (« Email non envoyé » + « Renvoyer l'email ») et
   * annoncé explicitement par le message de résultat.
   *
   * @returns id du compte auth + indicateur d'envoi d'e-mail
   */
  async inviterUtilisateur(
    email: string,
    redirectTo: string,
    metadata: Record<string, unknown>,
  ): Promise<{ authUserId: string; emailEnvoye: boolean }> {
    this.assertConfig();

    const url = `${this.baseUrl}/auth/v1/invite`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ email, data: metadata, redirect_to: redirectTo }),
    });

    if (res.ok) {
      const user = (await res.json()) as AuthUser;
      return { authUserId: user.id, emailEnvoye: true };
    }

    const detail = await res.text();
    if (/registered|exists/i.test(detail)) {
      const existant = await this.trouverParEmail(email);
      if (existant) {
        this.logger.warn(
          `inviteUserByEmail : ${email} déjà présent dans auth.users — réutilisation.`,
        );
        return { authUserId: existant.id, emailEnvoye: false };
      }
    }

    this.logger.warn(
      `E-mail d'invitation NON envoyé à ${email} (${res.status}: ${detail.slice(0, 200)}) — compte créé sans e-mail, emailEnvoye=false.`,
    );
    try {
      const cree = await this.creerUtilisateur(email, metadata);
      return { authUserId: cree.id, emailEnvoye: false };
    } catch (erreur) {
      // Cas d'un renvoi : le compte auth existe déjà (créé par une tentative
      // précédente) mais le premier appel /invite a échoué pour une AUTRE
      // raison que « exists » (ex. rate limit encore actif) — admin/users
      // échoue alors lui aussi avec « exists ». Dernier repli : le retrouver
      // plutôt que de faire remonter une erreur technique brute.
      const existant = await this.trouverParEmail(email);
      if (existant) {
        this.logger.warn(
          `admin/users a aussi échoué mais ${email} existe déjà dans auth.users — réutilisation.`,
        );
        return { authUserId: existant.id, emailEnvoye: false };
      }
      throw erreur;
    }
  }

  /** Création directe d'un compte auth sans mot de passe (repli). */
  private async creerUtilisateur(
    email: string,
    metadata: Record<string, unknown>,
  ): Promise<AuthUser> {
    const res = await fetch(`${this.baseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        email,
        email_confirm: false,
        user_metadata: metadata,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new InternalServerErrorException(
        `Création du compte Supabase impossible (${res.status}: ${detail.slice(0, 200)}).`,
      );
    }
    return (await res.json()) as AuthUser;
  }

  /** Pose le mot de passe choisi par l'invité et confirme son e-mail. */
  async definirMotDePasse(authUserId: string, motDePasse: string): Promise<void> {
    this.assertConfig();
    const res = await fetch(
      `${this.baseUrl}/auth/v1/admin/users/${authUserId}`,
      {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify({ password: motDePasse, email_confirm: true }),
      },
    );
    if (!res.ok) {
      const detail = await res.text();
      throw new InternalServerErrorException(
        `Activation du compte impossible (${res.status}: ${detail.slice(0, 200)}).`,
      );
    }
  }

  /**
   * Bloque (`bloque = true`) ou débloque un compte Auth : « ban » GoTrue — aucune nouvelle
   * connexion ni renouvellement de jeton. Le compte n'est JAMAIS supprimé. Renvoie `false`
   * (sans lever) si l'appel échoue : le statut applicatif REVOQUE reste, lui, appliqué par
   * l'API et par la RLS.
   */
  async definirBlocage(authUserId: string, bloque: boolean): Promise<boolean> {
    try {
      this.assertConfig();
      const res = await fetch(`${this.baseUrl}/auth/v1/admin/users/${authUserId}`, {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify({ ban_duration: bloque ? '876000h' : 'none' }),
      });
      if (!res.ok) {
        this.logger.error(`Blocage Auth ${authUserId} (${bloque}) refusé : ${res.status} ${(await res.text()).slice(0, 160)}`);
      }
      return res.ok;
    } catch (error) {
      this.logger.error(`Blocage Auth ${authUserId} impossible : ${error instanceof Error ? error.message : 'erreur inconnue'}`);
      return false;
    }
  }

  /** Supprime un compte auth (nettoyage si la finalisation échoue). */
  async supprimerUtilisateur(authUserId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/auth/v1/admin/users/${authUserId}`, {
        method: 'DELETE',
        headers: this.headers(),
      });
    } catch (error) {
      this.logger.error(
        `Échec suppression compte auth ${authUserId} : ${
          error instanceof Error ? error.message : 'erreur inconnue'
        }`,
      );
    }
  }

  private async trouverParEmail(email: string): Promise<AuthUser | null> {
    const res = await fetch(
      `${this.baseUrl}/auth/v1/admin/users?page=1&per_page=200`,
      { headers: this.headers() },
    );
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { users?: AuthUser[] };
    const cible = email.toLowerCase();
    return (
      body.users?.find((u) => (u.email ?? '').toLowerCase() === cible) ?? null
    );
  }
}
