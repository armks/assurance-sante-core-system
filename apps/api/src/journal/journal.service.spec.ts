import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { JournalService } from './journal.service';

const USER: AuthenticatedUser = { sub: 'u1', email: 'armelk01+testunitaire@gmail.com', postgresRole: 'authenticated', claimRole: null, aud: 'authenticated', token: 'jwt' };

/** Valeurs liées d'un appel queryRaw (modèle étiqueté), fragments Prisma.sql imbriqués compris. */
function valeurs(appel: unknown[]): unknown[] {
  const [, ...vals] = appel;
  return vals.flatMap((v) => (v && typeof v === 'object' && 'values' in (v as object) ? valeurs([null, ...((v as { values: unknown[] }).values)]) : [v]));
}

function service(role: string) {
  const identity = { getMe: jest.fn().mockResolvedValue({ profil: { id: 'u1', organisationId: 'org-1' }, permissions: { roleChain: [role] } }) };
  const prisma = { $queryRaw: jest.fn().mockResolvedValueOnce([{ total: BigInt(0) }]).mockResolvedValueOnce([]) };
  return { svc: new JournalService(prisma as never, identity as never), prisma };
}

describe('JournalService', () => {
  it.each(['ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_COMPTABLE', 'CENTRE_MEDICAL_ACCUEIL', 'SOCIETE_ADMINISTRATION', 'ADHERENT_TITULAIRE'])('%s : journal refusé (403), aucune lecture', async (role) => {
    const { svc, prisma } = service(role);
    await expect(svc.lister(USER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it.each(['ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE'])('%s : lecture limitée à son organisation', async (role) => {
    const { svc, prisma } = service(role);
    await expect(svc.lister(USER)).resolves.toEqual({ total: 0, lignes: [] });
    const vals = valeurs(prisma.$queryRaw.mock.calls[0]);
    expect(vals).toContain('org-1');
  });

  it('SUPERADMIN_PRINCIPAL : toutes les organisations (aucun filtre d’organisation)', async () => {
    const { svc, prisma } = service('SUPERADMIN_PRINCIPAL');
    await svc.lister(USER);
    const vals = valeurs(prisma.$queryRaw.mock.calls[0]);
    expect(vals).not.toContain('org-1');
  });

  it('plafonne la page à 200 lignes et refuse un décalage négatif', async () => {
    const { svc, prisma } = service('ASSUREUR_DIRECTION');
    await svc.lister(USER, { limite: 5000, decalage: -3 });
    const vals = valeurs(prisma.$queryRaw.mock.calls[1]);
    expect(vals).toContain(200);
    expect(vals).toContain(0);
  });
});
