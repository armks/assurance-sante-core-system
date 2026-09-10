import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdjudicationClientService,
  AdjudicationInjoignableError,
  AdjudicationRefusError,
  type DecisionAdjudication,
} from './adjudication-client.service';
import { ClaimsService } from './claims.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'expl@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

const identite = (roleChain: string[], organisationId: string | null = 'org-1') => ({
  profil: { id: 'u1', organisationId },
  permissions: roleChain.length ? { roleChain } : null,
});

const ACTE = {
  id: 'acte-1',
  dossierSoinsId: 'dos-1',
  categorieActe: 'CONSULTATION',
  montantPrescrit: '15000',
  quantite: 1,
};
const DOSSIER = {
  id: 'dos-1',
  organisationId: 'org-1',
  policeId: 'pol-1',
  planCouvertureId: 'gar-1',
  adherentId: 'adh-1',
  beneficiaireId: null,
};

const DECISION: DecisionAdjudication = {
  decision: 'AUTO_ADJUDIQUE',
  montant_rembourse: 12000,
  codes_rejet: [],
  plafond_restant_apres: 88000,
  duree_traitement_ms: 41,
};

describe('ClaimsService — soumission / verrouillage / adjudication', () => {
  let service: ClaimsService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let adjudication: { evaluer: jest.Mock };

  beforeEach(async () => {
    prisma = {
      acteDossier: { findFirst: jest.fn().mockResolvedValue(ACTE) },
      dossierSoins: { findFirst: jest.fn().mockResolvedValue(DOSSIER) },
      reclamation: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = {
      getMe: jest.fn().mockResolvedValue(identite(['ASSUREUR_EXPLOITATION'])),
    };
    adjudication = { evaluer: jest.fn().mockResolvedValue(DECISION) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ClaimsService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: AdjudicationClientService, useValue: adjudication },
      ],
    }).compile();
    service = moduleRef.get(ClaimsService);
  });

  it('verrouille SOUMISE → EN_ADJUDICATION, appelle le microservice, applique la décision', async () => {
    prisma.reclamation.findFirst
      .mockResolvedValueOnce(null) // pas de réclamation existante
      .mockResolvedValueOnce({ id: 'rec-1', statut: 'AUTO_ADJUDIQUE', codesRejet: [] }); // chargerReclamation
    prisma.reclamation.create.mockResolvedValue({ id: 'rec-1', statut: 'SOUMISE' });
    prisma.reclamation.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.soumettre(USER, { acteDossierId: 'acte-1' });

    expect(prisma.reclamation.updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-1', statut: 'SOUMISE', deletedAt: null },
      data: { statut: 'EN_ADJUDICATION' },
    });
    expect(adjudication.evaluer).toHaveBeenCalledWith('rec-1');
    expect(prisma.reclamation.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { statut: 'AUTO_ADJUDIQUE', codesRejet: [] },
    });
    expect(res.reclamation.statut).toBe('AUTO_ADJUDIQUE');
    expect(res.adjudication).toEqual(DECISION);
  });

  it('décision REJETE avec codes_rejet : les codes sont persistés', async () => {
    adjudication.evaluer.mockResolvedValue({
      ...DECISION,
      decision: 'REJETE',
      montant_rembourse: 0,
      codes_rejet: ['E001'],
    });
    prisma.reclamation.findFirst
      .mockResolvedValueOnce({ id: 'rec-1', statut: 'SOUMISE' })
      .mockResolvedValueOnce({ id: 'rec-1', statut: 'REJETE', codesRejet: ['E001'] });
    prisma.reclamation.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.soumettre(USER, { acteDossierId: 'acte-1' });

    expect(prisma.reclamation.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { statut: 'REJETE', codesRejet: ['E001'] },
    });
    expect(res.adjudication.decision).toBe('REJETE');
  });

  it('microservice INJOIGNABLE → réclamation remise à SOUMISE + 503', async () => {
    prisma.reclamation.findFirst
      .mockResolvedValueOnce({ id: 'rec-1', statut: 'SOUMISE' });
    prisma.reclamation.updateMany
      .mockResolvedValueOnce({ count: 1 }) // le verrouillage SOUMISE→EN_ADJUDICATION
      .mockResolvedValueOnce({ count: 1 }); // le retour EN_ADJUDICATION→SOUMISE
    prisma.reclamation.findUnique.mockResolvedValue({ id: 'rec-1', statut: 'EN_ADJUDICATION' });
    adjudication.evaluer.mockRejectedValue(
      new AdjudicationInjoignableError('timeout après 12000 ms'),
    );

    await expect(
      service.soumettre(USER, { acteDossierId: 'acte-1' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.reclamation.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'rec-1', statut: 'EN_ADJUDICATION', deletedAt: null },
      data: { statut: 'SOUMISE', codesRejet: ['ADJ_ECHEC'] },
    });
    // journalisation de l'échec
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('microservice renvoie une ERREUR HTTP → réclamation remise à SOUMISE + 502', async () => {
    prisma.reclamation.findFirst.mockResolvedValueOnce({ id: 'rec-1', statut: 'SOUMISE' });
    prisma.reclamation.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.reclamation.findUnique.mockResolvedValue({ id: 'rec-1', statut: 'EN_ADJUDICATION' });
    adjudication.evaluer.mockRejectedValue(
      new AdjudicationRefusError(500, 'Internal Server Error'),
    );

    await expect(
      service.soumettre(USER, { acteDossierId: 'acte-1' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('échec de transport mais la réclamation a déjà avancé → pas de retour à SOUMISE', async () => {
    prisma.reclamation.findFirst.mockResolvedValueOnce({ id: 'rec-1', statut: 'SOUMISE' });
    prisma.reclamation.updateMany.mockResolvedValueOnce({ count: 1 }); // verrouillage
    // le microservice a commité (statut avancé) avant que la réponse HTTP se perde
    prisma.reclamation.findUnique.mockResolvedValue({ id: 'rec-1', statut: 'AUTO_ADJUDIQUE' });
    adjudication.evaluer.mockRejectedValue(
      new AdjudicationInjoignableError('socket hang up'),
    );

    await expect(
      service.soumettre(USER, { acteDossierId: 'acte-1' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // on ne repasse PAS à SOUMISE
    expect(prisma.reclamation.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statut: 'SOUMISE' }) }),
    );
  });

  it('2e soumission d’une réclamation déjà EN_ADJUDICATION (idempotence) → 409, pas d’appel microservice', async () => {
    prisma.reclamation.findFirst.mockResolvedValue({ id: 'rec-1', statut: 'EN_ADJUDICATION' });

    await expect(
      service.soumettre(USER, { acteDossierId: 'acte-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(adjudication.evaluer).not.toHaveBeenCalled();
  });

  it('refuse un rôle non habilité (comptable)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    await expect(
      service.soumettre(USER, { acteDossierId: 'acte-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(adjudication.evaluer).not.toHaveBeenCalled();
  });
});
