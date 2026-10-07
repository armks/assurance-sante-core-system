import type { SanteAdjudication } from '../adjudication-client/adjudication-client.service';
import { SanteService } from './sante.service';

describe('SanteService (santé de la plateforme)', () => {
  const OK: SanteAdjudication = {
    statut: 'UP',
    latenceMs: 4,
    baseDeDonnees: 'UP',
    detail: null,
  };

  const service = (baseOk: boolean, adjudication: SanteAdjudication = OK) =>
    new SanteService(
      {
        $queryRawUnsafe: jest.fn(
          baseOk
            ? () => Promise.resolve([{ '?column?': 1 }])
            : () => Promise.reject(new Error('down')),
        ),
      } as any,
      { verifierSante: jest.fn().mockResolvedValue(adjudication) } as any,
    );

  it('tout répond → UP', async () => {
    const e = await service(true).etat();
    expect(e).toMatchObject({
      statut: 'UP',
      api: { statut: 'UP', baseDeDonnees: 'UP' },
      adjudication: OK,
    });
  });

  it('microservice injoignable → DEGRADE (facturation et comptoir pharmacie bloqués)', async () => {
    const e = await service(true, {
      statut: 'INJOIGNABLE',
      latenceMs: null,
      baseDeDonnees: 'INCONNU',
      detail: 'connexion impossible',
    }).etat();
    expect(e.statut).toBe('DEGRADE');
    expect(e.adjudication.statut).toBe('INJOIGNABLE');
  });

  it('microservice sans base → DEGRADE', async () => {
    const e = await service(true, {
      statut: 'DOWN',
      latenceMs: 3,
      baseDeDonnees: 'DOWN',
      detail: 'HTTP 503',
    }).etat();
    expect(e.statut).toBe('DEGRADE');
  });

  it('base de l’API injoignable → DEGRADE, base DOWN', async () => {
    const e = await service(false).etat();
    expect(e).toMatchObject({
      statut: 'DEGRADE',
      api: { baseDeDonnees: 'DOWN' },
    });
  });
});
