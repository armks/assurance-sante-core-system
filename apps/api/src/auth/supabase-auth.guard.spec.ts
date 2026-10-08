import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { SupabaseAuthGuard } from './supabase-auth.guard';

function contexte(authorization?: string) {
  const request: any = { headers: authorization ? { authorization } : {} };
  return { request, ctx: { switchToHttp: () => ({ getRequest: () => request }) } as any };
}

describe('SupabaseAuthGuard — compte révoqué refusé à chaque requête (ADR-007, lot 4)', () => {
  let guard: SupabaseAuthGuard;
  let prisma: { profil: { findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = { profil: { findUnique: jest.fn().mockResolvedValue({ statut: 'ACTIF' }) } };
    const config: any = { get: (cle: string) => (cle === 'SUPABASE_JWKS_URL' ? 'http://localhost/jwks' : undefined) };
    guard = new SupabaseAuthGuard(config, prisma as any);
    // la vérification cryptographique n'est pas l'objet de ce test : un jeton « valide » est simulé
    jest.spyOn(guard as any, 'verify').mockResolvedValue({ sub: 'u1', email: 'a@b.ci', role: 'authenticated', aud: 'authenticated' });
  });

  it('jeton valide, compte ACTIF : accepté', async () => {
    const { request, ctx } = contexte('Bearer jeton');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user.sub).toBe('u1');
    expect(prisma.profil.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { statut: true } });
  });

  it('jeton encore VALIDE mais compte REVOQUE : 403 COMPTE_REVOQUE (le statut est relu en base à chaque requête)', async () => {
    prisma.profil.findUnique.mockResolvedValue({ statut: 'REVOQUE' });
    const { request, ctx } = contexte('Bearer jeton');
    const err: any = await guard.canActivate(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ code: 'COMPTE_REVOQUE' });
    expect(request.user).toBeUndefined();
  });

  it('révocation prise en compte dès la requête suivante, sans attendre l’expiration du jeton', async () => {
    const { ctx } = contexte('Bearer jeton');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    prisma.profil.findUnique.mockResolvedValue({ statut: 'REVOQUE' });
    await expect(guard.canActivate(contexte('Bearer jeton').ctx)).rejects.toBeInstanceOf(ForbiddenException);
    prisma.profil.findUnique.mockResolvedValue({ statut: 'ACTIF' });
    await expect(guard.canActivate(contexte('Bearer jeton').ctx)).resolves.toBe(true); // réactivation explicite
  });

  it('compte sans profil (invité en cours d’activation) : non bloqué ; jeton absent ou invalide : 401', async () => {
    prisma.profil.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(contexte('Bearer jeton').ctx)).resolves.toBe(true);
    await expect(guard.canActivate(contexte().ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    (guard as any).verify.mockRejectedValue(new Error('jwt expired'));
    await expect(guard.canActivate(contexte('Bearer jeton').ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
