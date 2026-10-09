import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { DependancesService } from './dependances.service';
import { REGISTRE } from './registre';

const USER = { sub: 'u-appelant' } as AuthenticatedUser;

function service(rec: unknown, role: string, valeurs: Record<number, number> = {}, organisationId: string | null = null) {
  let i = 0;
  const modele = { findFirst: jest.fn(async () => rec), count: jest.fn(async () => valeurs[i++] ?? 0) };
  const db: any = new Proxy({}, { get: (t: any, p) => (p === '$executeRaw' ? jest.fn().mockResolvedValue(1) : p === '$transaction' ? jest.fn() : modele) });
  const identity = {
    getMe: jest.fn().mockResolvedValue({
      profil: { id: 'u-appelant', organisationId, societeId: null },
      permissions: { roleChain: role.split('+'), niveauAcces: 'ADMIN' },
    }),
  };
  return new DependancesService(db, identity as any);
}

const idx = (entite: keyof typeof REGISTRE, cle: string) => REGISTRE[entite].dependances.findIndex((d) => d.cle === cle);

describe('Lot barème 1 — lettres-clés (registre, ADR-007)', () => {
  const lettre = (actif: boolean) => ({ id: 'l-1', code: 'KC', libelle: 'Lettre-clé KC (fictif)', actif });

  it('suppression refusée avec les nombres : 3 actes nationaux et 2 actes d’organisations cotés', async () => {
    const valeurs = { [idx('lettreCle', 'actesNationaux')]: 3, [idx('lettreCle', 'actesOrganisations')]: 2 };
    const v = await service(lettre(true), 'SUPERADMIN_PRINCIPAL', valeurs).verifier(USER, 'lettreCle', 'l-1', 'supprimer');
    expect(v.possible).toBe(false);
    expect(v.raison).toContain('3 actes du catalogue national cotés');
    expect(v.raison).toContain('2 actes d’organisations cotés');
    expect(v.raison).toContain('Désactivez-la plutôt');
  });

  it('suppression possible sans aucun acte ; désactivation possible même si des actes la portent', async () => {
    expect((await service(lettre(true), 'SUPERADMIN_PRINCIPAL').verifier(USER, 'lettreCle', 'l-1', 'supprimer')).possible).toBe(true);
    const valeurs = { [idx('lettreCle', 'actesNationaux')]: 5 };
    expect((await service(lettre(true), 'SUPERADMIN_PRINCIPAL', valeurs).verifier(USER, 'lettreCle', 'l-1', 'archiver')).possible).toBe(true);
  });

  it('désactiver une lettre déjà désactivée, réactiver une lettre active : refusés', async () => {
    const d = await service(lettre(false), 'SUPERADMIN_PRINCIPAL').verifier(USER, 'lettreCle', 'l-1', 'archiver');
    expect(d.possible).toBe(false);
    expect(d.raison).toContain('déjà désactivée');
    expect((await service(lettre(true), 'SUPERADMIN_PRINCIPAL').verifier(USER, 'lettreCle', 'l-1', 'desarchiver')).possible).toBe(false);
    expect((await service(lettre(false), 'SUPERADMIN_PRINCIPAL').verifier(USER, 'lettreCle', 'l-1', 'desarchiver')).possible).toBe(true);
  });

  it('réservé au superadmin : tout autre rôle reçoit 403', async () => {
    await expect(service(lettre(true), 'ASSUREUR_INFORMATIQUE', {}, 'org-1').assertPossible(USER, 'lettreCle', 'l-1', 'supprimer')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('acte du référentiel : les actes de dossier sont comptés par lien fort (referentiel_acte_id) OU par code', () => {
    const dep = REGISTRE.referentielActe.dependances.find((d) => d.cle === 'actes')!;
    let where: any;
    void dep.compter({ acteDossier: { count: async (a: any) => { where = a.where; return 0; } } } as any, { id: 'ra-1', code: 'FICTIF-1' }, { organisationId: 'org-1' } as any);
    expect(where).toEqual({ dossier: { organisationId: 'org-1' }, OR: [{ referentielActeId: 'ra-1' }, { codeActe: 'FICTIF-1' }] });
  });
});
