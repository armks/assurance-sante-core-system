import {
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CareEpisodeService } from './care-episode.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'accueil@centre.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function identite(roleChain: string[], organisationId: string | null = 'org-1') {
  return {
    profil: { id: 'u1', organisationId },
    permissions: roleChain.length ? { roleChain } : null,
  };
}

const POLICE_ACTIVE = {
  id: 'pol-1',
  organisationId: 'org-1',
  statut: 'ACTIVE',
  dateDebut: new Date('2020-01-01'),
  dateFin: new Date('2999-12-31'),
  produitId: 'prod-1',
  deletedAt: null,
};
const ETAB_ACTIF = { id: 'etab-1', organisationId: 'org-1', statut: 'ACTIF', deletedAt: null };

describe('CareEpisodeService', () => {
  let service: CareEpisodeService;
  let prisma: any;
  let identity: { getMe: jest.Mock };

  beforeEach(async () => {
    prisma = {
      etablissementSante: { findFirst: jest.fn().mockResolvedValue(ETAB_ACTIF) },
      police: { findFirst: jest.fn().mockResolvedValue(POLICE_ACTIVE) },
      garantie: { findFirst: jest.fn().mockResolvedValue({ id: 'gar-1', delaiCarenceJours: null }) },
      dossierSoins: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      consultationDossier: {
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      profil: { findFirst: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CareEpisodeService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();

    service = moduleRef.get(CareEpisodeService);
  });

  const dtoOuverture = {
    adherentId: 'aaaaaaaa-1111-4111-8111-111111111111',
    etablissementId: 'etab-1',
    policeId: 'pol-1',
    motifConsultation: 'Fièvre',
  };

  it('ouvre un dossier quand toutes les conditions sont réunies', async () => {
    identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL']));
    prisma.dossierSoins.create.mockResolvedValue({
      id: 'dos-1',
      numeroTraitement: 'TRT-2026-09-000001',
    });
    prisma.dossierSoins.findFirst
      .mockResolvedValueOnce(null) // pas de dossier ouvert (évaluation)
      .mockResolvedValueOnce({ id: 'dos-1', statut: 'OUVERT', consultations: [] }); // chargerDossier

    const res = await service.ouvrirDossier(USER, dtoOuverture);

    expect(prisma.dossierSoins.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statut: 'OUVERT',
          carteValide: true,
          aucunDossierOuvert: true,
        }),
      }),
    );
    expect(res.statut).toBe('OUVERT');
  });

  it('REFUSE l’ouverture si un dossier est déjà OUVERT pour ce patient (blocage précis)', async () => {
    identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL']));
    prisma.dossierSoins.findFirst.mockResolvedValue({
      id: 'dos-0',
      numeroTraitement: 'TRT-2026-09-000009',
      statut: 'OUVERT',
    });

    await expect(service.ouvrirDossier(USER, dtoOuverture)).rejects.toMatchObject({
      response: {
        blocages: expect.arrayContaining([
          expect.stringContaining('déjà ouvert'),
        ]),
      },
    });
    expect(prisma.dossierSoins.create).not.toHaveBeenCalled();
  });

  it('REFUSE l’ouverture si la police n’est pas ACTIVE (carte non valide)', async () => {
    identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL']));
    prisma.police.findFirst.mockResolvedValue({
      ...POLICE_ACTIVE,
      statut: 'RESILIEE',
    });

    await expect(service.ouvrirDossier(USER, dtoOuverture)).rejects.toBeInstanceOf(
      ConflictException,
    );
    try {
      await service.ouvrirDossier(USER, dtoOuverture);
    } catch (e: any) {
      expect(e.response.blocages.join(' ')).toContain('Carte non valide');
      expect(e.response.evaluation.carteValide).toBe(false);
    }
    expect(prisma.dossierSoins.create).not.toHaveBeenCalled();
  });

  it('REFUSE d’ajouter une consultation avec un médecin d’un AUTRE établissement', async () => {
    identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_ACCUEIL']));
    prisma.dossierSoins.findFirst.mockResolvedValue({
      id: 'dos-1',
      organisationId: 'org-1',
      statut: 'OUVERT',
      etablissementId: 'etab-1',
    });
    prisma.profil.findFirst.mockResolvedValue({
      id: 'med-2',
      role: 'CENTRE_MEDICAL_MEDECIN',
      etablissementId: 'etab-2', // autre établissement
    });

    await expect(
      service.ajouterConsultation(USER, 'dos-1', {
        medecinId: 'med-2',
        motif: 'Suivi',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.consultationDossier.create).not.toHaveBeenCalled();
  });

  it('ajoute une consultation avec un médecin du bon établissement', async () => {
    identity.getMe.mockResolvedValue(identite(['CENTRE_MEDICAL_MEDECIN']));
    prisma.dossierSoins.findFirst.mockResolvedValue({
      id: 'dos-1',
      organisationId: 'org-1',
      statut: 'OUVERT',
      etablissementId: 'etab-1',
    });
    prisma.profil.findFirst.mockResolvedValue({
      id: 'med-1',
      role: 'CENTRE_MEDICAL_MEDECIN',
      etablissementId: 'etab-1',
    });
    prisma.consultationDossier.create.mockResolvedValue({
      id: 'cons-1',
      numeroConsultation: 'CST-2026-09-000001',
    });
    prisma.consultationDossier.findUnique.mockResolvedValue({ id: 'cons-1' });

    const res = await service.ajouterConsultation(USER, 'dos-1', {
      medecinId: 'med-1',
      motif: 'Consultation initiale',
    });
    expect(prisma.consultationDossier.create).toHaveBeenCalled();
    expect(res).toMatchObject({ id: 'cons-1' });
  });

  it('la clôture forcée est refusée à un rôle non ASSUREUR_EXPLOITATION', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    await expect(
      service.clotureForcee(USER, 'dos-1', { motif: 'Abandon de soins constaté' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('la clôture forcée par ASSUREUR_EXPLOITATION passe le dossier en FORCE_CLOS', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    prisma.dossierSoins.findFirst
      .mockResolvedValueOnce({ id: 'dos-1', organisationId: 'org-1', statut: 'OUVERT' })
      .mockResolvedValueOnce({ id: 'dos-1', statut: 'FORCE_CLOS', consultations: [] });
    prisma.dossierSoins.update.mockResolvedValue({});
    prisma.consultationDossier.updateMany.mockResolvedValue({});

    const res = await service.clotureForcee(USER, 'dos-1', {
      motif: 'Abandon de soins constaté',
    });
    expect(prisma.dossierSoins.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statut: 'FORCE_CLOS', clotureType: 'FORCEE' }),
      }),
    );
    expect(res.statut).toBe('FORCE_CLOS');
  });

  it('refuse l’ouverture à un rôle non autorisé (comptable)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    await expect(
      service.ouvrirDossier(USER, dtoOuverture),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
