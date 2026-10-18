import { ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { LicenceInterceptor } from './licence.interceptor';
import type { EtatAcces, EtatLicence } from './licence-etat';

const etat = (e: EtatAcces): EtatLicence => ({ etat: e, typeLicence: 'ANNUELLE', plan: 'BUSINESS', dateDebut: '2026-01-01', dateFin: '2026-10-01', joursRestants: -17, bientotExpiree: false });

function contexte(path: string, user: unknown) {
  return { switchToHttp: () => ({ getRequest: () => ({ path, user }) }) } as any;
}

describe('LicenceInterceptor', () => {
  const next = { handle: () => of('suite') };

  it('licence active : la requête passe', async () => {
    const licences = { etatOrganisation: jest.fn().mockResolvedValue(etat('ACTIVE')) };
    const i = new LicenceInterceptor(licences as any);
    await expect(lastValueFrom(i.intercept(contexte('/api/v1/policy/polices', { sub: 'u', organisationId: 'o' }), next))).resolves.toBe('suite');
  });

  it.each([
    ['EXPIREE', 'LICENCE_EXPIREE'],
    ['EN_ATTENTE_ACTIVATION', 'LICENCE_NON_ACTIVEE'],
    ['SUSPENDUE', 'LICENCE_SUSPENDUE'],
    ['ABSENTE', 'LICENCE_ABSENTE'],
  ] as [EtatAcces, string][])('licence %s : accès refusé (403 %s)', async (e, code) => {
    const licences = { etatOrganisation: jest.fn().mockResolvedValue(etat(e)) };
    const i = new LicenceInterceptor(licences as any);
    const err: any = await lastValueFrom(i.intercept(contexte('/api/v1/billing/cotisations', { sub: 'u', organisationId: 'o' }), next)).catch((x) => x);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ statusCode: 403, code });
  });

  it('routes libres même licence expirée : identité, statut, activation, santé', async () => {
    const licences = { etatOrganisation: jest.fn().mockResolvedValue(etat('EXPIREE')) };
    const i = new LicenceInterceptor(licences as any);
    for (const chemin of ['/api/v1/identity/me', '/api/v1/identity/me/photo', '/api/v1/licences/statut', '/api/v1/licences/activer', '/api/v1/sante']) {
      await expect(lastValueFrom(i.intercept(contexte(chemin, { sub: 'u', organisationId: 'o' }), next))).resolves.toBe('suite');
    }
    expect(licences.etatOrganisation).not.toHaveBeenCalled();
  });

  it('pas de société (superadmin) ou route publique : jamais contrôlé', async () => {
    const licences = { etatOrganisation: jest.fn() };
    const i = new LicenceInterceptor(licences as any);
    await expect(lastValueFrom(i.intercept(contexte('/api/v1/superadmin/licences', { sub: 's', organisationId: null }), next))).resolves.toBe('suite');
    await expect(lastValueFrom(i.intercept(contexte('/api/v1/public/evenements', undefined), next))).resolves.toBe('suite');
    expect(licences.etatOrganisation).not.toHaveBeenCalled();
  });

  it('une route voisine ne profite pas de l’exception (licences/activer-tout, identity/mes)', async () => {
    const licences = { etatOrganisation: jest.fn().mockResolvedValue(etat('EXPIREE')) };
    const i = new LicenceInterceptor(licences as any);
    for (const chemin of ['/api/v1/licences/activer-tout', '/api/v1/identity/mes-donnees', '/api/v1/superadmin/licences']) {
      const err: any = await lastValueFrom(i.intercept(contexte(chemin, { sub: 'u', organisationId: 'o' }), next)).catch((x) => x);
      expect(err).toBeInstanceOf(ForbiddenException);
    }
  });
});
