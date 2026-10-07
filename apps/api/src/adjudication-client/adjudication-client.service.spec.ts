import { AdjudicationClientService } from './adjudication-client.service';

describe('AdjudicationClientService.verifierSante (sonde /readyz du microservice)', () => {
  const fetchOrigine = global.fetch;
  let client: AdjudicationClientService;

  beforeEach(() => {
    process.env.ADJUDICATION_SERVICE_URL = 'http://adjudication.test:8899';
    process.env.ADJUDICATION_SANTE_TIMEOUT_MS = '50';
    client = new AdjudicationClientService();
  });
  afterEach(() => {
    global.fetch = fetchOrigine;
    delete process.env.ADJUDICATION_SANTE_TIMEOUT_MS;
  });

  const reponse = (status: number, corps: unknown) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => corps,
    }) as Response;

  it('microservice prêt (base joignable) → UP, latence mesurée, appel non authentifié sur /readyz', async () => {
    const f = jest
      .fn()
      .mockResolvedValue(reponse(200, { status: 'UP', database: 'UP' }));
    global.fetch = f;

    const s = await client.verifierSante();

    expect(s).toMatchObject({
      statut: 'UP',
      baseDeDonnees: 'UP',
      detail: null,
    });
    expect(s.latenceMs).toBeGreaterThanOrEqual(0);
    expect(f.mock.calls[0][0]).toBe('http://adjudication.test:8899/readyz');
    expect(f.mock.calls[0][1]?.headers).toBeUndefined();
  });

  it('microservice qui répond 503 (base injoignable) → DOWN, base DOWN, détail repris', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      reponse(503, {
        status: 'DOWN',
        database: 'DOWN',
        detail: 'CannotGetJdbcConnectionException',
      }),
    );

    const s = await client.verifierSante();

    expect(s).toMatchObject({
      statut: 'DOWN',
      baseDeDonnees: 'DOWN',
      detail: 'CannotGetJdbcConnectionException',
    });
  });

  it('aucune réponse (connexion refusée) → INJOIGNABLE, sans lever d’exception ni exposer l’URL', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        new TypeError('fetch failed: ECONNREFUSED adjudication.test'),
      );

    const s = await client.verifierSante();

    expect(s).toEqual({
      statut: 'INJOIGNABLE',
      latenceMs: null,
      baseDeDonnees: 'INCONNU',
      detail: 'connexion impossible',
    });
  });

  it('réponse trop lente → INJOIGNABLE (timeout)', async () => {
    global.fetch = jest.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_ok, ko) => {
          init?.signal?.addEventListener('abort', () =>
            ko(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    ) as unknown as typeof fetch;

    const s = await client.verifierSante();

    expect(s.statut).toBe('INJOIGNABLE');
    expect(s.detail).toBe('timeout après 50 ms');
  });
});
