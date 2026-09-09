import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'compta@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function identite(roleChain: string[]) {
  return {
    profil: {
      id: 'u1',
      organisationId: 'org-1',
      entite: 'ASSUREUR',
      societeId: null,
    },
    permissions: roleChain.length ? { roleChain } : null,
  };
}

const POLICE = {
  id: 'po1',
  organisationId: 'org-1',
  souscripteurId: 's1',
  produitId: 'pr1',
  statut: 'ACTIVE',
};

describe('BillingService', () => {
  let service: BillingService;
  let prisma: {
    police: { findFirst: jest.Mock };
    produit: { findFirst: jest.Mock };
    souscripteur: { findFirst: jest.Mock; findUnique: jest.Mock };
    grilleTarifaire: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    planPaiementCollectivite: { findFirst: jest.Mock };
    cotisation: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      police: { findFirst: jest.fn() },
      produit: { findFirst: jest.fn() },
      souscripteur: { findFirst: jest.fn(), findUnique: jest.fn() },
      grilleTarifaire: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      planPaiementCollectivite: { findFirst: jest.fn() },
      cotisation: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();

    service = moduleRef.get(BillingService);
  });

  it('calcule avec le tarif STANDARD par tranche d’âge', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    prisma.police.findFirst.mockResolvedValue(POLICE);
    prisma.grilleTarifaire.findFirst
      .mockResolvedValueOnce(null) // pas de tarif négocié
      .mockResolvedValueOnce({
        id: 'g-std',
        montantMensuel: '12000',
        trancheAgeMin: 18,
        trancheAgeMax: 59,
      });
    prisma.souscripteur.findUnique.mockResolvedValue({ type: 'ENTREPRISE' });

    const res = await service.calculerCotisation(USER, {
      policeId: 'po1',
      periode: '2026-01-01',
      age: 35,
    });

    expect(res).toEqual({
      montantDu: '12000.00',
      tarifBase: '12000.00',
      source: 'STANDARD',
      partMembrePourcent: 100,
      grilleTarifaireId: 'g-std',
    });
  });

  it('le tarif NÉGOCIÉ société prend priorité sur le standard', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    prisma.police.findFirst.mockResolvedValue(POLICE);
    prisma.grilleTarifaire.findFirst.mockResolvedValueOnce({
      id: 'g-nego',
      montantMensuel: '9500',
      trancheAgeMin: 18,
      trancheAgeMax: 59,
    });
    prisma.souscripteur.findUnique.mockResolvedValue({ type: 'ENTREPRISE' });

    const res = await service.calculerCotisation(USER, {
      policeId: 'po1',
      periode: '2026-01-01',
      age: 35,
    });

    expect(res.source).toBe('NEGOCIE');
    expect(res.montantDu).toBe('9500.00');
    // le tarif standard n'a même pas été interrogé
    expect(prisma.grilleTarifaire.findFirst).toHaveBeenCalledTimes(1);
  });

  it('applique part_membre_pourcent pour une COLLECTIVITE subventionnée', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    prisma.police.findFirst.mockResolvedValue(POLICE);
    prisma.grilleTarifaire.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'g-std', montantMensuel: '10000' });
    prisma.souscripteur.findUnique.mockResolvedValue({ type: 'COLLECTIVITE' });
    prisma.planPaiementCollectivite.findFirst.mockResolvedValue({
      partMembrePourcent: '70.00',
    });

    const res = await service.calculerCotisation(USER, {
      policeId: 'po1',
      periode: '2026-01-01',
      age: 40,
    });

    // 10000 * 70 / 100 = 7000.00 (part du membre)
    expect(res.montantDu).toBe('7000.00');
    expect(res.tarifBase).toBe('10000.00');
    expect(res.partMembrePourcent).toBe(70);
  });

  it('passe en EN_RETARD les cotisations échues (pénalité 0 par défaut)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    prisma.cotisation.findMany.mockResolvedValue([
      {
        id: 'c1',
        montantDu: '5000',
        statut: 'A_PAYER',
        police: { produitId: 'pr1' },
      },
    ]);

    const res = await service.marquerEnRetard(USER);

    expect(res).toEqual({ misEnRetard: 1 });
    expect(prisma.cotisation.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { statut: 'EN_RETARD', penaliteAppliquee: '0.00' },
    });
  });

  it('refuse la facturation à un rôle non habilité (exploitation)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    await expect(
      service.marquerEnRetard(USER),
    ).rejects.toMatchObject({ status: 403 });
  });
});
