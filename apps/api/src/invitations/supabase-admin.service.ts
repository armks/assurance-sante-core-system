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
   * (sans mot de passe) et déclenche l'e-mail d'invitation. Retombe sur une
   * création simple si l'envoi d'e-mail échoue (SMTP non configuré en dev), afin
   * que le flux reste utilisable — l'invité recevra le lien par un autre canal.
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
      `inviteUserByEmail a échoué (${res.status}: ${detail.slice(0, 200)}) — repli sur admin/users.`,
    );
    const cree = await this.creerUtilisateur(email, metadata);
    return { authUserId: cree.id, emailEnvoye: false };
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
