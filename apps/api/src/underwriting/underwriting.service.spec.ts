import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { UnderwritingService } from './underwriting.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'medecin@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function identite(
  roleChain: string[],
  opts: { societeId?: string | null } = {},
) {
  return {
    profil: {
      id: 'u1',
      organisationId: 'org-1',
      entite: 'ASSUREUR',
      societeId: opts.societeId ?? null,
    },
    permissions: roleChain.length ? { roleChain } : null,
  };
}

describe('UnderwritingService', () => {
  let service: UnderwritingService;
  let prisma: {
    questionnaireMedical: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    souscripteur: { findFirst: jest.Mock };
    police: { findFirst: jest.Mock };
    grilleTarifaire: { findFirst: jest.Mock };
    tarificationIndividuelle: { create: jest.Mock; findUnique: jest.Mock };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      questionnaireMedical: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      souscripteur: { findFirst: jest.fn() },
      police: { findFirst: jest.fn() },
      grilleTarifaire: { findFirst: jest.fn() },
      tarificationIndividuelle: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UnderwritingService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();

    service = moduleRef.get(UnderwritingService);
  });

  // ═══════════════════════════════════════════════════════════════════
  //  LE test le plus important du module : séparation médecin conseil / souscripteur
  // ═══════════════════════════════════════════════════════════════════
  it('REFUSE (403) qu’un ASSUREUR_MEDECIN_CONSEIL évalue un questionnaire', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_MEDECIN_CONSEIL']));

    await expect(
      service.evaluerQuestionnaire(USER, 'q1', { decision: 'ACCEPTE' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // il ne doit même pas pouvoir charger le questionnaire
    expect(prisma.questionnaireMedical.findFirst).not.toHaveBeenCalled();
    expect(prisma.questionnaireMedical.update).not.toHaveBeenCalled();
  });

  it('REFUSE (403) qu’un ASSUREUR_MEDECIN_CONSEIL lise un questionnaire', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_MEDECIN_CONSEIL']));
    prisma.questionnaireMedical.findFirst.mockResolvedValue({
      id: 'q1',
      souscripteurId: 's1',
    });

    await expect(
      service.obtenirQuestionnaire(USER, 'q1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('AUTORISE un ASSUREUR_MEDECIN_SOUSCRIPTEUR à évaluer', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ASSUREUR_MEDECIN_SOUSCRIPTEUR']),
    );
    prisma.questionnaireMedical.findFirst
      .mockResolvedValueOnce({ id: 'q1', souscripteurId: 's1', decision: null }) // chargerQuestionnaireBrut
      .mockResolvedValueOnce({
        id: 'q1',
        souscripteurId: 's1',
        decision: 'ACCEPTE',
      }); // chargerQuestionnaire (retour)

    const res = await service.evaluerQuestionnaire(USER, 'q1', {
      decision: 'ACCEPTE',
    });

    expect(prisma.questionnaireMedical.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: expect.objectContaining({
        decision: 'ACCEPTE',
        validePar: 'u1',
        dateDecision: expect.any(Date),
      }),
    });
    expect(res.decision).toBe('ACCEPTE');
  });

  it('le souscripteur individuel peut soumettre son questionnaire', async () => {
    identity.getMe.mockResolvedValue(
      identite(['SOUSCRIPTEUR_INDIVIDUEL'], { societeId: 's1' }),
    );
    prisma.souscripteur.findFirst.mockResolvedValue({
      id: 's1',
      organisationId: 'org-1',
      type: 'INDIVIDUEL',
    });
    prisma.questionnaireMedical.findFirst
      .mockResolvedValueOnce(null) // pas de questionnaire existant
      .mockResolvedValueOnce({
        id: 'q1',
        souscripteurId: 's1',
        decision: null,
      }); // chargerQuestionnaire
    prisma.questionnaireMedical.create.mockResolvedValue({ id: 'q1' });

    const res = await service.soumettreQuestionnaire(USER, {
      souscripteurId: 's1',
      reponses: { fumeur: false },
    });

    expect(prisma.questionnaireMedical.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        souscripteurId: 's1',
        dateSoumission: expect.any(Date),
      }),
    });
    expect(res.decision).toBeNull();
  });

  it('refuse ACCEPTE_SURPRIME sans surprimePourcent', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ASSUREUR_MEDECIN_SOUSCRIPTEUR']),
    );
    prisma.questionnaireMedical.findFirst.mockResolvedValue({
      id: 'q1',
      souscripteurId: 's1',
      decision: null,
    });

    await expect(
      service.evaluerQuestionnaire(USER, 'q1', { decision: 'ACCEPTE_SURPRIME' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('calcule la prime individuelle = prime_base + surprime (20 %)', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ASSUREUR_MEDECIN_SOUSCRIPTEUR']),
    );
    prisma.police.findFirst.mockResolvedValue({
      id: 'po1',
      organisationId: 'org-1',
      produitId: 'pr1',
      souscripteurId: 's1',
    });
    prisma.questionnaireMedical.findFirst.mockResolvedValue({
      id: 'q1',
      souscripteurId: 's1',
      decision: 'ACCEPTE_SURPRIME',
      surprimePourcent: '20.00',
    });
    prisma.grilleTarifaire.findFirst.mockResolvedValue({
      montantMensuel: '10000',
    });
    prisma.tarificationIndividuelle.create.mockResolvedValue({ id: 't1' });
    prisma.tarificationIndividuelle.findUnique.mockResolvedValue({
      id: 't1',
      primeBase: '10000.00',
      surprimeMedicale: '2000.00',
      primeFinale: '12000.00',
    });

    const res = await service.calculerPrime(USER, {
      policeId: 'po1',
      questionnaireMedicalId: 'q1',
      ageASubscription: 40,
    });

    expect(prisma.tarificationIndividuelle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        primeBase: '10000.00',
        surprimeMedicale: '2000.00', // 10000 * 20 / 100
      }),
    });
    expect(res?.primeFinale).toBe('12000.00');
  });
});
