import {
  ConflictException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CareEpisodeService } from '../care-episode/care-episode.service';
import { IdentityService } from '../identity/identity.service';
import { TarifsProposesService } from '../tarifs-proposes/tarifs-proposes.service';
import { tarifsProposesDeTest } from '../tarifs-proposes/tarifs-proposes.testing';
import { PrismaService } from '../prisma/prisma.service';
import { PreauthorizationService } from './preauthorization.service';
import { CategoriesActeService } from '../reference/categories-acte.service';
import { categoriesActeServiceDeTest } from '../reference/categories-acte.testing';
import { AdjudicationClientService } from '../adjudication-client/adjudication-client.service';
import { adjudicationClientDeTest } from '../adjudication-client/adjudication-client.testing';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'armelk01+testunitaire@gmail.com',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

const ADH = 'aaaaaaaa-1111-4111-8111-111111111111';

function identiteAdherent() {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role: 'ADHERENT_TITULAIRE', adherentId: ADH },
    permissions: { roleChain: ['ADHERENT_TITULAIRE'] },
  };
}
function identiteEtablissement(
  etablissementId: string | null = 'etab-1',
  role = 'CENTRE_MEDICAL_ACCUEIL',
) {
  return {
    profil: { id: 'e1', organisationId: 'org-1', role, adherentId: null, etablissementId },
    permissions: { roleChain: [role] },
  };
}

const DANS_48H = new Date(Date.now() + 48 * 3600 * 1000);
const HIER = new Date(Date.now() - 3600 * 1000);

/** Microservice d'adjudication factice (simulation : 80 % par défaut). */
let adjudication: ReturnType<typeof adjudicationClientDeTest>;
beforeEach(() => {
  adjudication = adjudicationClientDeTest();
});

describe('PreauthorizationService — Code de Consultation', () => {
  let service: PreauthorizationService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let careEpisode: {
    evaluerEligibilite: jest.Mock;
    ouvrirDossier: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      etablissementSante: { findFirst: jest.fn().mockResolvedValue({ id: 'etab-1', nom: 'Centre A' }) },
      codeConsultation: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      beneficiaire: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };
    careEpisode = {
      evaluerEligibilite: jest.fn().mockResolvedValue({ blocages: [] }),
      ouvrirDossier: jest.fn().mockResolvedValue({ id: 'dos-1', numeroTraitement: 'TRT-2026-09-000001', statut: 'OUVERT' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: AdjudicationClientService, useValue: adjudication },
        { provide: TarifsProposesService, useValue: tarifsProposesDeTest() },
        { provide: CategoriesActeService, useValue: categoriesActeServiceDeTest() },
        PreauthorizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: CareEpisodeService, useValue: careEpisode },
      ],
    }).compile();

    service = moduleRef.get(PreauthorizationService);
  });

  const dtoGen = { etablissementId: 'etab-1', policeId: 'pol-1' };

  it('refuse la génération à un non-adhérent', async () => {
    identity.getMe.mockResolvedValue(identiteEtablissement());
    await expect(
      service.genererCodeConsultation(USER, dtoGen),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuse la génération si l’éligibilité n’est pas réunie (blocages)', async () => {
    identity.getMe.mockResolvedValue(identiteAdherent());
    careEpisode.evaluerEligibilite.mockResolvedValue({
      blocages: ['Carte non valide : la police n\'est pas active (statut : RESILIEE).'],
    });
    await expect(
      service.genererCodeConsultation(USER, dtoGen),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.codeConsultation.create).not.toHaveBeenCalled();
  });

  it('génère un code cryptographiquement sûr (8 car. alphanumériques), statut EMIS, et le renvoie à l’adhérent', async () => {
    identity.getMe.mockResolvedValue(identiteAdherent());
    prisma.codeConsultation.create.mockImplementation(({ data }: any) => ({
      id: 'code-1',
      ...data,
      canalEnvoi: ['APP', 'SMS'],
      dateEmission: new Date(),
      dateExpiration: DANS_48H,
    }));

    const res = await service.genererCodeConsultation(USER, dtoGen);

    expect(res.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(res.statut).toBe('EMIS');
    expect(prisma.codeConsultation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ adherentId: ADH, statut: 'EMIS' }),
      }),
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Couverture bénéficiaires (audit dashboard adhérent) : un code pour un
  //  bénéficiaire doit avoir `adherentId = null` (jamais les deux à la fois),
  //  et le bénéficiaire ciblé doit appartenir à l'appelant.
  // ═══════════════════════════════════════════════════════════════════════
  it('génère un code pour un bénéficiaire propre — adherentId reste null (mutuellement exclusifs)', async () => {
    identity.getMe.mockResolvedValue(identiteAdherent());
    prisma.beneficiaire.findFirst.mockResolvedValue({ id: 'ben-1', adherentId: ADH });
    prisma.codeConsultation.create.mockImplementation(({ data }: any) => ({
      id: 'code-1',
      ...data,
      canalEnvoi: ['APP', 'SMS'],
      dateEmission: new Date(),
      dateExpiration: DANS_48H,
    }));

    await service.genererCodeConsultation(USER, { ...dtoGen, beneficiaireId: 'ben-1' });

    expect(prisma.beneficiaire.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'ben-1', adherentId: ADH }) }),
    );
    expect(prisma.codeConsultation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ adherentId: null, beneficiaireId: 'ben-1' }),
      }),
    );
  });

  it('refuse un code pour un bénéficiaire qui n’appartient pas à l’appelant (403, pas de fuite)', async () => {
    identity.getMe.mockResolvedValue(identiteAdherent());
    prisma.beneficiaire.findFirst.mockResolvedValue(null);

    await expect(
      service.genererCodeConsultation(USER, { ...dtoGen, beneficiaireId: 'ben-autre' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.codeConsultation.create).not.toHaveBeenCalled();
  });

  it('listerMesCodes : pagination serveur (skip/take), statut et période d’émission, total filtré', async () => {
    identity.getMe.mockResolvedValue(identiteAdherent());
    prisma.beneficiaire.findMany.mockResolvedValue([]);
    prisma.codeConsultation.count.mockResolvedValue(61);

    const res = await service.listerMesCodes(USER, { page: 2, limite: 25, statut: 'EXPIRE', du: '2025-03-01', au: '2025-03-31' });

    const appel = prisma.codeConsultation.findMany.mock.calls[0][0];
    expect(appel).toMatchObject({ skip: 25, take: 25 });
    expect(appel.where).toMatchObject({
      statut: 'EXPIRE',
      dateEmission: { gte: new Date('2025-03-01T00:00:00.000Z'), lt: new Date('2025-04-01T00:00:00.000Z') },
    });
    expect(prisma.codeConsultation.count).toHaveBeenCalledWith({ where: appel.where });
    expect(res).toMatchObject({ total: 61, page: 2, limite: 25, pages: 3 });
  });

  it('listerMesCodes inclut les codes émis pour SES bénéficiaires, pas seulement les siens', async () => {
    identity.getMe.mockResolvedValue(identiteAdherent());
    prisma.beneficiaire.findMany.mockResolvedValue([{ id: 'ben-1' }, { id: 'ben-2' }]);

    await service.listerMesCodes(USER);

    expect(prisma.beneficiaire.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ adherentId: ADH }) }),
    );
    expect(prisma.codeConsultation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ adherentId: ADH }, { beneficiaireId: { in: ['ben-1', 'ben-2'] } }] },
      }),
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Couverture bénéficiaires (audit du 2026-09-24) : chargerCodeAdherent
  //  (confirmerPresence/annulerCode) ne vérifiait que `code.adherentId ===
  //  ctx.adherentId`, refusant l'accès à l'adhérent pour un code émis pour
  //  l'un de ses propres bénéficiaires — même incohérence qu'obtenirFacture.
  // ═══════════════════════════════════════════════════════════════════════
  describe('confirmerPresence / annulerCode — couverture bénéficiaires', () => {
    it('confirmerPresence sur le code d’un enfant (bénéficiaire) → autorisé', async () => {
      identity.getMe.mockResolvedValue(identiteAdherent());
      prisma.codeConsultation.findFirst.mockResolvedValue({
        id: 'code-1', organisationId: 'org-1', adherentId: null, beneficiaireId: 'ben-1', statut: 'EMIS',
      });
      prisma.beneficiaire.findFirst.mockResolvedValue({ id: 'ben-1', adherentId: ADH });

      const res = await service.confirmerPresence(USER, 'code-1');

      expect(prisma.beneficiaire.findFirst).toHaveBeenCalledWith({
        where: { id: 'ben-1', adherentId: ADH, deletedAt: null },
        select: { id: true },
      });
      expect(res).toEqual({ id: 'code-1', statut: 'CONFIRME_PATIENT' });
    });

    it('annulerCode sur le code d’un enfant (bénéficiaire) → autorisé', async () => {
      identity.getMe.mockResolvedValue(identiteAdherent());
      prisma.codeConsultation.findFirst.mockResolvedValue({
        id: 'code-1', organisationId: 'org-1', adherentId: null, beneficiaireId: 'ben-1', statut: 'EMIS',
      });
      prisma.beneficiaire.findFirst.mockResolvedValue({ id: 'ben-1', adherentId: ADH });

      const res = await service.annulerCode(USER, 'code-1');

      expect(res).toEqual({ id: 'code-1', statut: 'ANNULE' });
    });

    it('confirmerPresence sur le code du bénéficiaire d’un AUTRE adhérent → 403 (pas de fuite)', async () => {
      identity.getMe.mockResolvedValue(identiteAdherent());
      prisma.codeConsultation.findFirst.mockResolvedValue({
        id: 'code-1', organisationId: 'org-1', adherentId: null, beneficiaireId: 'ben-1', statut: 'EMIS',
      });
      prisma.beneficiaire.findFirst.mockResolvedValue(null); // ben-1 n'appartient pas à ADH

      await expect(
        service.confirmerPresence(USER, 'code-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('confirmerPresence sur le code d’un AUTRE adhérent (pas un bénéficiaire) → 403', async () => {
      identity.getMe.mockResolvedValue(identiteAdherent());
      prisma.codeConsultation.findFirst.mockResolvedValue({
        id: 'code-1', organisationId: 'org-1', adherentId: 'adh-autre', beneficiaireId: null, statut: 'EMIS',
      });

      await expect(
        service.confirmerPresence(USER, 'code-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.beneficiaire.findFirst).not.toHaveBeenCalled();
    });
  });

  it('VALIDATION avec un MAUVAIS établissement → 403, le dossier n’est pas ouvert', async () => {
    identity.getMe.mockResolvedValue(identiteEtablissement());
    prisma.codeConsultation.findUnique.mockResolvedValue({
      id: 'code-1',
      organisationId: 'org-1',
      statut: 'EMIS',
      dateExpiration: DANS_48H,
      etablissementId: 'etab-1',
      adherentId: ADH,
      policeId: 'pol-1',
    });

    await expect(
      service.validerCodeConsultation(USER, {
        code: 'ABCD2345',
        etablissementId: 'etab-AUTRE',
        motifConsultation: 'Fièvre',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(careEpisode.ouvrirDossier).not.toHaveBeenCalled();
  });

  it('VALIDATION d’un code EXPIRÉ → 410, et le statut passe EXPIRE', async () => {
    identity.getMe.mockResolvedValue(identiteEtablissement());
    prisma.codeConsultation.findUnique.mockResolvedValue({
      id: 'code-1',
      organisationId: 'org-1',
      statut: 'EMIS',
      dateExpiration: HIER,
      etablissementId: 'etab-1',
      adherentId: ADH,
      policeId: 'pol-1',
    });

    await expect(
      service.validerCodeConsultation(USER, {
        code: 'ABCD2345',
        etablissementId: 'etab-1',
        motifConsultation: 'Fièvre',
      }),
    ).rejects.toBeInstanceOf(GoneException);
    expect(prisma.codeConsultation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { statut: 'EXPIRE' } }),
    );
    expect(careEpisode.ouvrirDossier).not.toHaveBeenCalled();
  });

  it('VALIDATION d’un code déjà UTILISE_ETABLISSEMENT → 409', async () => {
    identity.getMe.mockResolvedValue(identiteEtablissement());
    prisma.codeConsultation.findUnique.mockResolvedValue({
      id: 'code-1',
      organisationId: 'org-1',
      statut: 'UTILISE_ETABLISSEMENT',
      dateExpiration: DANS_48H,
      etablissementId: 'etab-1',
      adherentId: ADH,
      policeId: 'pol-1',
    });

    await expect(
      service.validerCodeConsultation(USER, {
        code: 'ABCD2345',
        etablissementId: 'etab-1',
        motifConsultation: 'Fièvre',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('VALIDATION OK → ouvre le dossier via CareEpisode (avec codeConsultationId) et ne renvoie PAS la valeur du code', async () => {
    identity.getMe.mockResolvedValue(identiteEtablissement());
    prisma.codeConsultation.findUnique.mockResolvedValue({
      id: 'code-1',
      code: 'ABCD2345',
      organisationId: 'org-1',
      statut: 'EMIS',
      dateExpiration: DANS_48H,
      etablissementId: 'etab-1',
      adherentId: ADH,
      beneficiaireId: null,
      policeId: 'pol-1',
    });

    const res = await service.validerCodeConsultation(USER, {
      code: 'abcd2345',
      etablissementId: 'etab-1',
      motifConsultation: 'Fièvre et céphalées',
    });

    expect(careEpisode.ouvrirDossier).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({
        adherentId: ADH,
        etablissementId: 'etab-1',
        policeId: 'pol-1',
        motifConsultation: 'Fièvre et céphalées',
      }),
      { codeConsultationId: 'code-1' },
    );
    expect(res.dossier).toMatchObject({ id: 'dos-1' });
    expect(res.code.statut).toBe('UTILISE_ETABLISSEMENT');
    expect((res as any).code.code).toBeUndefined();
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Fuite inter-établissement corrigée (reproduction du test du PROMPT 18,
  //  audit demandé explicitement) : `code.etablissementId !== dto.etablissementId`
  //  ne vérifiait que la cohérence du corps de la requête — jamais que
  //  l'APPELANT appartenait lui-même à cet établissement. Reproduit en HTTP
  //  réel (201, dossier ouvert) avant ce fix.
  // ═══════════════════════════════════════════════════════════════════════
  it('CENTRE_MEDICAL_ACCUEIL d’un AUTRE établissement ne peut PAS valider un code (même avec le bon dto.etablissementId) → 403', async () => {
    identity.getMe.mockResolvedValue(identiteEtablissement('etab-B'));
    prisma.codeConsultation.findUnique.mockResolvedValue({
      id: 'code-1',
      organisationId: 'org-1',
      statut: 'EMIS',
      dateExpiration: DANS_48H,
      etablissementId: 'etab-A',
      adherentId: ADH,
      policeId: 'pol-1',
    });

    await expect(
      service.validerCodeConsultation(USER, {
        code: 'ABCD2345',
        etablissementId: 'etab-A', // correspond bien au code — la fraude porte sur l'appelant
        motifConsultation: 'Tentative établissement B',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(careEpisode.ouvrirDossier).not.toHaveBeenCalled();
  });

  it('ASSUREUR_EXPLOITATION (staff, sans établissement propre) peut valider un code de n’importe quel établissement', async () => {
    identity.getMe.mockResolvedValue(identiteEtablissement(null, 'ASSUREUR_EXPLOITATION'));
    prisma.codeConsultation.findUnique.mockResolvedValue({
      id: 'code-1',
      code: 'ABCD2345',
      organisationId: 'org-1',
      statut: 'EMIS',
      dateExpiration: DANS_48H,
      etablissementId: 'etab-A',
      adherentId: ADH,
      beneficiaireId: null,
      policeId: 'pol-1',
    });

    const res = await service.validerCodeConsultation(USER, {
      code: 'ABCD2345',
      etablissementId: 'etab-A',
      motifConsultation: 'Supervision assureur',
    });
    expect(careEpisode.ouvrirDossier).toHaveBeenCalled();
    expect(res.dossier).toMatchObject({ id: 'dos-1' });
  });
});
