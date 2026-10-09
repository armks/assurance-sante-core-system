import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { DependancesService } from './dependances.service';
import { REGISTRE } from './registre';

const USER = { sub: 'u-appelant' } as AuthenticatedUser;

function service(rec: unknown, role: string, comptes: { lignes?: { id: string }[]; actes?: number } = {}) {
  const modele = {
    findFirst: jest.fn(async () => rec),
    findMany: jest.fn(async () => comptes.lignes ?? []),
    count: jest.fn(async () => comptes.actes ?? 0),
  };
  const db: any = new Proxy({}, { get: (t: any, p) => (p === '$executeRaw' ? jest.fn().mockResolvedValue(1) : p === '$transaction' ? jest.fn() : modele) });
  const identity = {
    getMe: jest.fn().mockResolvedValue({
      profil: { id: 'u-appelant', organisationId: 'org-1', societeId: null },
      permissions: { roleChain: role.split('+'), niveauAcces: 'ADMIN' },
    }),
  };
  return new DependancesService(db, identity as any);
}

const conv = (statut: string) => ({ id: 'c-1', numero: 'FICTIF-CONV-1', version: 1, statut });
const ligne = (statutConvention: string) => ({ id: 'l-1', convention: { statut: statutConvention, numero: 'FICTIF-CONV-1' }, referentielActe: { code: 'FICTIF-A1', libelle: 'Acte fictif' } });

describe('Lot barème 2 — conventions (registre, règle « tarif ayant servi »)', () => {
  it('modifier : seulement une convention PROPOSEE ; validée → « nouvelle version » ; refusée → reproposer ; archivée → nouvelle version', async () => {
    const v = (statut: string) => service(conv(statut), 'ASSUREUR_INFORMATIQUE').verifier(USER, 'convention', 'c-1', 'modifier');
    expect((await v('PROPOSEE')).possible).toBe(true);
    expect((await v('VALIDEE')).raison).toContain('créez une nouvelle version');
    expect((await v('REFUSEE')).raison).toContain('reproposée');
    expect((await v('ARCHIVEE')).raison).toContain('archivée ne se modifie plus');
  });

  it('supprimer : seulement proposée ou refusée ; validée ou archivée conservée (historique)', async () => {
    const v = (statut: string) => service(conv(statut), 'ASSUREUR_INFORMATIQUE').verifier(USER, 'convention', 'c-1', 'supprimer');
    expect((await v('PROPOSEE')).possible).toBe(true);
    expect((await v('REFUSEE')).possible).toBe(true);
    for (const statut of ['VALIDEE', 'ARCHIVEE']) {
      const r = await v(statut);
      expect(r.possible).toBe(false);
      expect(r.raison).toContain('conservée');
    }
  });

  it('archiver : seulement une convention validée ; déjà archivée / proposée refusées', async () => {
    const v = (statut: string) => service(conv(statut), 'ASSUREUR_INFORMATIQUE').verifier(USER, 'convention', 'c-1', 'archiver');
    expect((await v('VALIDEE')).possible).toBe(true);
    expect((await v('ARCHIVEE')).possible).toBe(false);
    expect((await v('PROPOSEE')).raison).toContain('Seule une convention validée s’archive');
  });

  it('« tarif ayant servi » : 4 actes calculés avec un forfait de la convention → ni suppression ni modification (409 chiffré) ; archivage toujours possible', async () => {
    const contexte = { lignes: [{ id: 'l-1' }, { id: 'l-2' }], actes: 4 };
    const s = (action: 'supprimer' | 'modifier' | 'archiver') => service(conv('PROPOSEE'), 'ASSUREUR_INFORMATIQUE', contexte).verifier(USER, 'convention', 'c-1', action);
    const sup = await s('supprimer');
    expect(sup.possible).toBe(false);
    expect(sup.raison).toContain('4 actes calculés avec un forfait de cette convention');
    expect((await s('modifier')).possible).toBe(false);
    expect((await service(conv('VALIDEE'), 'ASSUREUR_INFORMATIQUE', contexte).verifier(USER, 'convention', 'c-1', 'archiver')).possible).toBe(true);
  });

  it('ligne d’une convention : modifiable et supprimable seulement tant que la convention est proposée ; forfait ayant servi bloqué', async () => {
    const v = (statut: string, actes = 0, action: 'supprimer' | 'modifier' = 'modifier') =>
      service(ligne(statut), 'ASSUREUR_INFORMATIQUE', { actes }).verifier(USER, 'conventionActe', 'l-1', action);
    expect((await v('PROPOSEE')).possible).toBe(true);
    for (const statut of ['VALIDEE', 'REFUSEE', 'ARCHIVEE']) expect((await v(statut)).possible).toBe(false);
    const servi = await v('PROPOSEE', 2, 'supprimer');
    expect(servi.possible).toBe(false);
    expect(servi.raison).toContain('2 actes calculés avec ce forfait');
  });

  it('seule l’assurance informatique interroge le registre sur une convention ; les autres rôles reçoivent 403', async () => {
    for (const role of ['ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_DIRECTION', 'ASSUREUR_COMPTABLE']) {
      await expect(service(conv('PROPOSEE'), role).assertPossible(USER, 'convention', 'c-1', 'modifier')).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('la convention est cherchée dans l’organisation du jeton', () => {
    let where: any;
    const db: any = { convention: { findFirst: (a: any) => { where = a.where; return null; } } };
    void REGISTRE.convention.charger(db, 'c-1', { organisationId: 'org-1' } as any);
    expect(where).toEqual({ id: 'c-1', organisationId: 'org-1', deletedAt: null });
  });
});
