import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { from, mergeMap, Observable } from 'rxjs';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import type { EtatAcces } from './licence-etat';
import { LicencesService } from './licences.service';

/** Routes toujours accessibles, licence ou non : l'identité (pour afficher le bon écran), le statut / l'activation et la sonde de santé. */
const CHEMINS_LIBRES = /^\/api\/v1\/(identity\/me(\/|$)|licences\/(statut|activer)$|sante$)/;

const MESSAGES: Record<Exclude<EtatAcces, 'ACTIVE'>, [string, string]> = {
  EXPIREE: ['LICENCE_EXPIREE', 'La licence de votre société a expiré. Contactez votre administrateur pour la renouveler.'],
  EN_ATTENTE_ACTIVATION: ['LICENCE_NON_ACTIVEE', 'La licence de votre société n’est pas encore activée. Contactez votre administrateur.'],
  SUSPENDUE: ['LICENCE_SUSPENDUE', 'La licence de votre société est suspendue. Contactez le support de la plateforme.'],
  ABSENTE: ['LICENCE_ABSENTE', 'Aucune licence n’est associée à votre société. Contactez le support de la plateforme.'],
};

/**
 * Coupe l'accès à l'application (toutes les routes sauf celles ci-dessus) pour les comptes d'une société dont la licence n'est pas
 * active : expirée, non activée, suspendue ou absente. Les comptes sans société (superadmin) ne sont pas concernés. Seule la route
 * d'activation reste ouverte (réservée à l'informatique et à la direction), pour permettre de rétablir l'accès.
 */
@Injectable()
export class LicenceInterceptor implements NestInterceptor {
  constructor(private readonly licences: LicencesService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser & { organisationId?: string | null } }>();
    const organisationId = req.user?.organisationId;
    if (!organisationId || CHEMINS_LIBRES.test(req.path)) return next.handle();
    return from(this.licences.etatOrganisation(organisationId)).pipe(
      mergeMap((etat) => {
        if (etat.etat === 'ACTIVE') return next.handle();
        const [code, message] = MESSAGES[etat.etat];
        throw new ForbiddenException({ statusCode: 403, code, message, licence: etat });
      }),
    );
  }
}
