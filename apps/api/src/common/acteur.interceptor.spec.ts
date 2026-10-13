import { firstValueFrom, Observable, of } from 'rxjs';
import { acteurCourant } from './acteur.context';
import { ActeurInterceptor } from './acteur.interceptor';

const contexte = (user?: { sub: string }) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as never;

describe('ActeurInterceptor', () => {
  it('pose l’utilisateur authentifié dans le contexte de toute la requête, code asynchrone compris', async () => {
    let vu: string | undefined;
    const suite = new Observable<string>((abonne) => {
      setTimeout(() => {
        vu = acteurCourant()?.userId;
        abonne.next('ok');
        abonne.complete();
      }, 5);
    });
    await firstValueFrom(new ActeurInterceptor().intercept(contexte({ sub: 'u-42' }), { handle: () => suite }) as Observable<string>);
    expect(vu).toBe('u-42');
  });

  it('route publique (sans utilisateur) : aucun acteur', async () => {
    let vu: unknown = 'init';
    const obs = new ActeurInterceptor().intercept(contexte(undefined), {
      handle: () => {
        vu = acteurCourant();
        return of('ok');
      },
    });
    await firstValueFrom(obs as Observable<string>);
    expect(vu).toBeUndefined();
  });

  it('en dehors d’une requête : pas d’acteur', () => {
    expect(acteurCourant()).toBeUndefined();
  });
});
