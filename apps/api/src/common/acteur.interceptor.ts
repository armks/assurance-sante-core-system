import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { acteurStorage } from './acteur.context';

/**
 * Pose l'utilisateur authentifié (posé par `SupabaseAuthGuard`) dans le contexte asynchrone de la requête :
 * toute écriture en base faite pendant le traitement est alors journalisée à son nom (voir `PrismaService`).
 * Les routes publiques (sans utilisateur) passent sans contexte : aucune écriture n'y est attribuée à quelqu'un.
 */
@Injectable()
export class ActeurInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (!user?.sub) return next.handle();
    return new Observable((abonne) => {
      acteurStorage.run({ userId: user.sub }, () => {
        next.handle().subscribe(abonne);
      });
    });
  }
}
