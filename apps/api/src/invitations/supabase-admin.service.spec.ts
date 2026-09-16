import { InternalServerErrorException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SupabaseAdminService } from './supabase-admin.service';

function reponse(ok: boolean, status: number, corps: unknown) {
  return {
    ok,
    status,
    json: async () => corps,
    text: async () => JSON.stringify(corps),
  } as any;
}

describe('SupabaseAdminService — inviterUtilisateur', () => {
  let service: SupabaseAdminService;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

    const moduleRef = await Test.createTestingModule({
      providers: [SupabaseAdminService],
    }).compile();
    service = moduleRef.get(SupabaseAdminService);

    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  it('succès direct : /invite répond 200 → emailEnvoye = true', async () => {
    fetchMock.mockResolvedValueOnce(reponse(true, 200, { id: 'auth-1' }));

    const res = await service.inviterUtilisateur('a@x.ci', '/r', {});

    expect(res).toEqual({ authUserId: 'auth-1', emailEnvoye: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("échec /invite = compte déjà existant → réutilisation directe (emailEnvoye = false)", async () => {
    fetchMock.mockResolvedValueOnce(
      reponse(false, 422, { error_code: 'email_exists', msg: 'already been registered' }),
    );
    fetchMock.mockResolvedValueOnce(
      reponse(true, 200, { users: [{ id: 'auth-existant', email: 'a@x.ci' }] }),
    );

    const res = await service.inviterUtilisateur('a@x.ci', '/r', {});

    expect(res).toEqual({ authUserId: 'auth-existant', emailEnvoye: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('échec /invite pour une autre raison (ex. rate limit) → repli admin/users réussi', async () => {
    fetchMock.mockResolvedValueOnce(
      reponse(false, 429, { error_code: 'over_email_send_rate_limit', msg: 'rate limit exceeded' }),
    );
    fetchMock.mockResolvedValueOnce(reponse(true, 200, { id: 'auth-cree' }));

    const res = await service.inviterUtilisateur('b@x.ci', '/r', {});

    expect(res).toEqual({ authUserId: 'auth-cree', emailEnvoye: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it(
    'renvoi après un premier échec non-"exists" (ex. rate limit) : /invite échoue ' +
      'à nouveau pour rate limit ET admin/users échoue car le compte existe déjà ' +
      '→ dernier repli sur trouverParEmail, PAS d’exception brute (bug corrigé)',
    async () => {
      fetchMock.mockResolvedValueOnce(
        reponse(false, 429, { error_code: 'over_email_send_rate_limit', msg: 'rate limit exceeded' }),
      );
      fetchMock.mockResolvedValueOnce(
        reponse(false, 422, { error_code: 'email_exists', msg: 'already been registered' }),
      );
      fetchMock.mockResolvedValueOnce(
        reponse(true, 200, { users: [{ id: 'auth-existant-2', email: 'c@x.ci' }] }),
      );

      const res = await service.inviterUtilisateur('c@x.ci', '/r', {});

      expect(res).toEqual({ authUserId: 'auth-existant-2', emailEnvoye: false });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it(
    'échec total et irrécupérable : /invite et admin/users échouent tous deux, ' +
      'et le compte est introuvable → l’exception remonte (pas de succès inventé)',
    async () => {
      fetchMock.mockResolvedValueOnce(
        reponse(false, 500, { error_code: 'unexpected_failure', msg: 'panne Supabase' }),
      );
      fetchMock.mockResolvedValueOnce(
        reponse(false, 500, { error_code: 'unexpected_failure', msg: 'panne Supabase' }),
      );
      fetchMock.mockResolvedValueOnce(reponse(true, 200, { users: [] }));

      await expect(
        service.inviterUtilisateur('d@x.ci', '/r', {}),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    },
  );
});
