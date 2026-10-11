import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { DependancesService } from '../dependances/dependances.service';
import { dependancesDeTest } from '../dependances/dependances.testing';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesActeService } from '../reference/categories-acte.service';
import { categoriesActeServiceDeTest } from '../reference/categories-acte.testing';
import { LettresClesService } from '../reference/lettres-cles.service';
import { lettresClesServiceDeTest } from '../reference/lettres-cles.testing';
import { SanteService } from '../sante/sante.service';
import { SuperadminConfigService } from './superadmin-config.service';
import { MAX_ELEMENTS_ACTION_MASSE } from './superadmin.types';

const USER = { sub: 'u1', token: 'jwt' } as unknown as AuthenticatedUser;
const profil = (role: string) => ({
  profil: { id: 'u1', organisationId: role === 'SUPERADMIN_PRINCIPAL' ? null : 'org-1' },
  permissions: { roleChain: [role] },
});
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Actions de masse sur le catalogue national (superadmin) — un cas par règle. */
describe('SuperadminConfigService — actions de masse sur le catalogue national', () => {
  let service: SuperadminConfigService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let dependances: ReturnType<typeof dependancesDeTest>;

  const actes = [1, 2, 3].map((n) => ({ id: uuid(n), code: `FICT-A${n}`, libelle: `Acte fictif ${n}`, statut: 'HOMOLOGUE' }));

  beforeEach(async () => {
    dependances = dependancesDeTest();
    prisma = {
      referentielNationalActe: {
        findMany: jest.fn().mockResolvedValue(actes),
        findFirst: jest.fn(async ({ where }: any) => actes.find((a) => a.id === where.id) ?? null),
        update: jest.fn(),
      },
      referentielNationalMedicament: {
        findMany: jest.fn().mockResolvedValue([{ id: uuid(9), denominationCommune: 'Paracétamol fictif', nomCommercial: 'Parafic' }]),
        findFirst: jest.fn(async () => ({ id: uuid(9), denominationCommune: 'Paracétamol fictif', statutHomologation: 'HOMOLOGUE' })),
        update: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn().mockResolvedValue(profil('SUPERADMIN_PRINCIPAL')) };
    const module = await Test.createTestingModule({
      providers: [
        SuperadminConfigService,
        { provide: PrismaService, useValue: prisma },
        { provide: DependancesService, useValue: dependances },
        { provide: IdentityService, useValue: identity },
        { provide: CategoriesActeService, useValue: categoriesActeServiceDeTest() },
        { provide: LettresClesService, useValue: lettresClesServiceDeTest() },
        { provide: SanteService, useValue: { etat: jest.fn() } },
      ],
    }).compile();
    service = module.get(SuperadminConfigService);
  });

  const ids = actes.map((a) => a.id);

  it.each([
    'ASSUREUR_INFORMATIQUE',
    'ASSUREUR_MEDECIN_CONSEIL',
    'ASSUREUR_DIRECTION',
    'ASSUREUR_COMPTABLE',
    'ASSUREUR_EXPLOITATION',
    'SOCIETE_ADMINISTRATION',
    'CENTRE_MEDICAL_COMPTABLE',
  ])('%s : 403 pour les trois actions, aucune lecture ni écriture', async (role) => {
    identity.getMe.mockResolvedValue(profil(role));
    for (const action of ['archiver', 'desarchiver', 'supprimer'] as const) {
      await expect(service.actionMasseCatalogue(USER, 'actes', action, ids)).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(prisma.referentielNationalActe.update).not.toHaveBeenCalled();
    expect(prisma.referentielNationalActe.findMany).not.toHaveBeenCalled();
  });

  it('sélection vide : 400 ; plus de 100 éléments : 400 ; doublons : traités une seule fois', async () => {
    await expect(service.actionMasseCatalogue(USER, 'actes', 'archiver', [])).rejects.toBeInstanceOf(BadRequestException);
    const trop = Array.from({ length: MAX_ELEMENTS_ACTION_MASSE + 1 }, (_, i) => uuid(100 + i));
    await expect(service.actionMasseCatalogue(USER, 'actes', 'archiver', trop)).rejects.toThrow(/Au plus 100 éléments/);
    const r = await service.actionMasseCatalogue(USER, 'actes', 'archiver', [ids[0], ids[0], ids[0]]);
    expect(r.demandes).toBe(1);
    expect(prisma.referentielNationalActe.update).toHaveBeenCalledTimes(1);
  });

  it('ARCHIVER : chaque élément est contrôlé individuellement (registre) puis passe RETIRE avec sa date de retrait et son audit', async () => {
    const r = await service.actionMasseCatalogue(USER, 'actes', 'archiver', ids);
    expect(r).toMatchObject({ type: 'actes', action: 'archiver', demandes: 3, reussis: 3, refuses: 0 });
    expect(dependances.assertPossible.mock.calls.map((c: any[]) => [c[1], c[2], c[3]])).toEqual(
      ids.map((id) => ['acteNational', id, 'archiver']),
    );
    const maj = prisma.referentielNationalActe.update.mock.calls.map((c: any) => c[0]);
    expect(maj).toHaveLength(3);
    expect(maj[0]).toMatchObject({ where: { id: ids[0] }, data: { statut: 'RETIRE' } });
    expect(maj[0].data.dateRetrait).toBeInstanceOf(Date);
    // audit : une ligne par élément + la synthèse du lot
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(4);
    expect(r.resultats.map((x) => x.nom)).toEqual(['FICT-A1 — Acte fictif 1', 'FICT-A2 — Acte fictif 2', 'FICT-A3 — Acte fictif 3']);
  });

  it('DÉSARCHIVER : repasse HOMOLOGUE, date de retrait effacée', async () => {
    await service.actionMasseCatalogue(USER, 'actes', 'desarchiver', [ids[0]]);
    expect(prisma.referentielNationalActe.update.mock.calls[0][0]).toMatchObject({ data: { statut: 'HOMOLOGUE', dateRetrait: null } });
    expect(dependances.assertPossible.mock.calls[0].slice(1)).toEqual(['acteNational', ids[0], 'desarchiver']);
  });

  it('SUPPRIMER : élément IMPORTÉ par une organisation non supprimable — résultat PARTIEL avec la raison en français', async () => {
    dependances.assertPossible.mockImplementation(async (_u: unknown, entite: string, id: string, action: string) => {
      if (id === ids[1]) {
        throw new ConflictException({ message: 'L’acte « FICT-A2 — Acte fictif 2 » est lié à 2 organisations qui l’ont importé : archivez-le plutôt.' });
      }
      return { entite, id, nom: '', action, possible: true, raison: null, liens: [] };
    });
    const r = await service.actionMasseCatalogue(USER, 'actes', 'supprimer', ids);
    expect(r).toMatchObject({ demandes: 3, reussis: 2, refuses: 1 });
    expect(r.resultats[1]).toMatchObject({ id: ids[1], ok: false, raison: expect.stringContaining('2 organisations qui l’ont importé') });
    expect(r.resultats[0].ok && r.resultats[2].ok).toBe(true);
    const supprimes = prisma.referentielNationalActe.update.mock.calls.map((c: any) => c[0].where.id);
    expect(supprimes).toEqual([ids[0], ids[2]]);
    expect(prisma.referentielNationalActe.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date); // suppression LOGIQUE
  });

  it('archiver un élément déjà archivé : refusé avec sa raison, les autres passent', async () => {
    dependances.assertPossible.mockImplementation(async (_u: unknown, entite: string, id: string, action: string) => {
      if (id === ids[0]) throw new ConflictException({ message: 'L’acte est déjà archivé.' });
      return { entite, id, nom: '', action, possible: true, raison: null, liens: [] };
    });
    const r = await service.actionMasseCatalogue(USER, 'actes', 'archiver', ids);
    expect(r.refuses).toBe(1);
    expect(r.resultats[0]).toMatchObject({ ok: false, raison: 'L’acte est déjà archivé.' });
  });

  it('élément introuvable ou déjà supprimé : refusé et tracé à part', async () => {
    const r = await service.actionMasseCatalogue(USER, 'actes', 'supprimer', [ids[0], uuid(77)]);
    expect(r.resultats[1]).toMatchObject({ ok: false, raison: 'Acte introuvable dans le catalogue national.', nom: uuid(77) });
    expect(dependances.tracerRefusMetier).toHaveBeenCalledWith(
      USER,
      'referentiel_national_actes',
      uuid(77),
      'masse_supprimer',
      'Acte introuvable dans le catalogue national.',
    );
  });

  it('MÉDICAMENTS : mêmes règles sur leur propre table et leur statut d’homologation', async () => {
    const r = await service.actionMasseCatalogue(USER, 'medicaments', 'archiver', [uuid(9)]);
    expect(r.resultats[0]).toMatchObject({ ok: true, nom: 'Paracétamol fictif (Parafic)' });
    expect(dependances.assertPossible.mock.calls[0].slice(1)).toEqual(['medicamentNational', uuid(9), 'archiver']);
    expect(prisma.referentielNationalMedicament.update.mock.calls[0][0]).toMatchObject({ data: { statutHomologation: 'RETIRE' } });
    expect(prisma.referentielNationalActe.update).not.toHaveBeenCalled();
  });

  it('une erreur technique (non HTTP) n’est pas avalée', async () => {
    prisma.referentielNationalActe.update.mockRejectedValue(new Error('base indisponible'));
    await expect(service.actionMasseCatalogue(USER, 'actes', 'archiver', [ids[0]])).rejects.toThrow('base indisponible');
  });
});
