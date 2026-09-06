import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import type { AuthenticatedUser } from './authenticated-user.interface';

/**
 * SupabaseAuthGuard — valide, sur chaque requête entrante, le JWT émis par
 * Supabase Auth.
 *
 * Règle transverse du skill : signature ASYMÉTRIQUE (ECC P-256), vérifiée via le
 * jeu de clés publiques JWKS (`SUPABASE_JWKS_URL`). Aucun secret partagé —
 * `SUPABASE_JWT_SECRET` n'existe pas dans ce projet.
 *
 * Le guard extrait `sub` (= profils.id) et l'email des claims et les injecte
 * dans `request.user` (lu ensuite via `@CurrentUser()`). Le rôle métier n'est
 * PAS déduit du token : IdentityService le charge depuis `profils`.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);
  private readonly jwks: JwksClient;
  private readonly issuer?: string;
  private readonly audience: string;

  constructor(private readonly config: ConfigService) {
    const jwksUri = this.config.get<string>('SUPABASE_JWKS_URL');
    if (!jwksUri) {
      throw new Error(
        'SUPABASE_JWKS_URL manquant — impossible de vérifier les JWT Supabase.',
      );
    }
    this.jwks = new JwksClient({
      jwksUri,
      cache: true,
      cacheMaxAge: 10 * 60 * 1000, // 10 min
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
    this.issuer = this.config.get<string>('SUPABASE_JWT_ISSUER');
    this.audience =
      this.config.get<string>('SUPABASE_JWT_AUDIENCE') ?? 'authenticated';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Jeton Bearer absent.');
    }

    let payload: jwt.JwtPayload;
    try {
      payload = await this.verify(token);
    } catch (error) {
      this.logger.debug(
        `Rejet JWT : ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      );
      throw new UnauthorizedException('Jeton invalide ou expiré.');
    }

    if (!payload.sub) {
      throw new UnauthorizedException('Jeton sans identifiant utilisateur (sub).');
    }

    request.user = {
      sub: payload.sub,
      email: (payload.email as string | undefined) ?? null,
      postgresRole: (payload.role as string | undefined) ?? null,
      claimRole:
        (payload.user_role as string | undefined) ??
        ((payload.app_metadata as Record<string, unknown> | undefined)?.[
          'role'
        ] as string | undefined) ??
        null,
      aud: payload.aud ?? null,
      token,
    };

    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) {
      return null;
    }
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }

  private verify(token: string): Promise<jwt.JwtPayload> {
    const getKey: jwt.GetPublicKeyOrSecret = (header, callback) => {
      this.jwks
        .getSigningKey(header.kid)
        .then((key) => callback(null, key.getPublicKey()))
        .catch((err) => callback(err as Error));
    };

    return new Promise((resolve, reject) => {
      jwt.verify(
        token,
        getKey,
        {
          algorithms: ['ES256', 'RS256'],
          audience: this.audience,
          issuer: this.issuer,
        },
        (err, decoded) => {
          if (err) {
            reject(err);
            return;
          }
          if (!decoded || typeof decoded === 'string') {
            reject(new Error('Payload JWT inattendu.'));
            return;
          }
          resolve(decoded);
        },
      );
    });
  }
}
