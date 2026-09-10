import {
  ConflictException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CareEpisodeService } from '../care-episode/care-episode.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { PreauthorizationService } from './preauthorization.service';

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
function identiteEtablissement() {
  return {
    profil: { id: 'e1', organisationId: 'org-1', role: 'CENTRE_MEDICAL_ACCUEIL', adherentId: null },
    permissions: { roleChain: ['CENTRE_MEDICAL_ACCUEIL'] },
  };
}

const DANS_48H = new Date(Date.now() + 48 * 3600 * 1000);
const HIER = new Date(Date.now() - 3600 * 1000);

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
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
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
});
