import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './authenticated-user.interface';

/**
 * @CurrentUser() — récupère le contexte d'auth posé par SupabaseAuthGuard.
 * Renvoie `undefined` si la route n'est pas passée par le guard.
 *
 *   me(@CurrentUser() user: AuthenticatedUser) { ... }
 *   me(@CurrentUser('sub') userId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    return data && user ? user[data] : user;
  },
);
